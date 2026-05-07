/**
 * Email service. Transport selection (in order):
 *   1. Resend (RESEND_API_KEY set)        — preferred for serverless
 *   2. Nodemailer SMTP (SMTP_HOST set)    — self-hosted / VPS
 *   3. Console banner                      — dev fallback so the magic link
 *                                           is visible in logs
 */
import nodemailer, { type Transporter } from 'nodemailer';
import { Resend } from 'resend';
import { config } from '../../lib/config.js';
import { logger } from '../../lib/logger.js';

let smtpTransport: Transporter | null = null;
let resendClient: Resend | null = null;

function getSmtpTransport(): Transporter | null {
  if (!config.smtp.enabled) return null;
  if (!smtpTransport) {
    smtpTransport = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.port === 465,
      auth: config.smtp.user
        ? { user: config.smtp.user, pass: config.smtp.pass }
        : undefined,
    });
  }
  return smtpTransport;
}

function getResendClient(): Resend | null {
  if (!config.resend.enabled) return null;
  if (!resendClient) {
    resendClient = new Resend(config.resend.apiKey);
  }
  return resendClient;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text?: string;
  html?: string;
}

function logDevBanner(msg: EmailMessage): void {
  const banner = '╔════════════════ DEV EMAIL (no transport configured) ═══════════╗';
  const footer = '╚════════════════════════════════════════════════════════════════╝';
  // eslint-disable-next-line no-console
  console.log(`\n${banner}`);
  // eslint-disable-next-line no-console
  console.log(`To:      ${msg.to}`);
  // eslint-disable-next-line no-console
  console.log(`Subject: ${msg.subject}`);
  // eslint-disable-next-line no-console
  console.log('─────────────────────────────────────────────────────────────');
  // eslint-disable-next-line no-console
  console.log(msg.text ?? msg.html ?? '');
  // eslint-disable-next-line no-console
  console.log(`${footer}\n`);
}

export async function sendEmail(msg: EmailMessage): Promise<void> {
  // In tests, never call out to a real provider — magic-link tests assert
  // the banner output and would otherwise hit live Resend/SMTP.
  if (config.isTest) {
    logDevBanner(msg);
    return;
  }
  const resend = getResendClient();
  if (resend) {
    // Resend's CreateEmailOptions requires exactly one of html | text | react |
    // template. Build the payload such that only the keys we have are present.
    const base = { from: config.resend.from, to: msg.to, subject: msg.subject };
    const payload = msg.html
      ? { ...base, html: msg.html, ...(msg.text ? { text: msg.text } : {}) }
      : { ...base, text: msg.text ?? '' };
    const { error } = await resend.emails.send(payload);
    if (error) {
      throw new Error(`Resend send failed: ${error.message}`);
    }
    logger.info('email sent', { to: msg.to, subject: msg.subject, via: 'resend' });
    return;
  }

  const t = getSmtpTransport();
  if (t) {
    await t.sendMail({
      from: config.smtp.from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
    logger.info('email sent', { to: msg.to, subject: msg.subject, via: 'smtp' });
    return;
  }

  // Dev-mode fallback: log loudly so the dev can find the magic link.
  logDevBanner(msg);
}
