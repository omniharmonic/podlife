/**
 * Branded email layout — the editorial "letter" frame Pod Life uses for
 * every transactional email. Wraps a slot of content in the parchment
 * paper, terracotta seal, and Instrument Serif / DM Sans typography from
 * the rest of the product (with web-font fallbacks for clients that don't
 * load custom fonts).
 *
 * Voice ground rules apply: lead with care, never logistics. Body copy
 * should sound like a short hand-written note, not a system email.
 *
 * Email rendering quirks worth knowing about:
 *  - Most clients strip <style> blocks and external CSS. We inline every
 *    style on every element so the layout works in Gmail, Outlook, and
 *    iOS Mail.
 *  - Outlook on Windows uses Word's HTML engine and ignores most modern
 *    CSS. We avoid grid/flex and rely on tables + max-width.
 *  - Custom fonts (Instrument Serif, DM Sans) only load in webmail clients
 *    that allow @font-face. The font stacks degrade gracefully to native
 *    serif/sans pairings (Iowan / Palatino / Georgia for the display, the
 *    system sans for the body).
 *
 * The exported function takes a small content spec rather than raw HTML
 * so callers can stay focused on the message — fonts, colors, spacing,
 * footer all stay consistent across emails.
 */

interface LetterContent {
  /** Optional small uppercase eyebrow above the headline (DM Mono). */
  eyebrow?: string;
  /** The italic display headline — feels like the salutation of a letter. */
  headline: string;
  /** Body paragraphs, plain text. Each becomes its own <p>. */
  body: string[];
  /**
   * Optional "feature" element after the headline — used for the login
   * code, an upcoming time block, etc. Pre-rendered HTML.
   */
  feature?: string;
  /** Quiet footer line — disclaimer or "you can ignore this" copy. */
  postscript?: string;
}

const PARCHMENT = '#FAF7F2';
const CARD = '#FFFFFF';
const INK_900 = '#1B1814';
const INK_700 = '#3F3A33';
const INK_500 = '#6B655B';
const INK_300 = '#A39B8E';
const INK_100 = '#E5DDD0';
const TERRACOTTA = '#E07A5F';

const SERIF =
  "'Instrument Serif', 'Iowan Old Style', 'Palatino Linotype', Georgia, serif";
const SANS =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, 'Helvetica Neue', Arial, sans-serif";
const MONO =
  "ui-monospace, 'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderLetter(content: LetterContent): string {
  const eyebrow = content.eyebrow
    ? `<p style="margin: 0 0 14px; font-family: ${MONO}; font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: ${INK_500};">${escapeHtml(content.eyebrow)}</p>`
    : '';

  const bodyParas = content.body
    .map(
      (p) =>
        `<p style="margin: 0 0 16px; font-family: ${SANS}; font-size: 16px; line-height: 1.65; color: ${INK_700};">${escapeHtml(p)}</p>`,
    )
    .join('');

  const feature = content.feature
    ? `<div style="margin: 22px 0 28px;">${content.feature}</div>`
    : '';

  const postscript = content.postscript
    ? `<p style="margin: 28px 0 0; padding-top: 20px; border-top: 1px solid ${INK_100}; font-family: ${SANS}; font-size: 13px; line-height: 1.6; color: ${INK_500}; font-style: italic;">${escapeHtml(content.postscript)}</p>`
    : '';

  // Note: the date in the masthead is intentionally regenerated server-side
  // so each email feels like a fresh letter dated today.
  const today = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date());

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light only" />
  <meta name="supported-color-schemes" content="light" />
  <title>Pod Life</title>
</head>
<body style="margin: 0; padding: 0; background-color: ${PARCHMENT}; font-family: ${SANS}; color: ${INK_900};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: ${PARCHMENT};">
    <tr>
      <td align="center" style="padding: 40px 16px 56px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 560px;">
          <!-- Masthead — the dateline of a letter -->
          <tr>
            <td style="padding: 0 4px 18px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="font-family: ${MONO}; font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: ${INK_300};">Pod Life · A letter</td>
                  <td align="right" style="font-family: ${MONO}; font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: ${INK_300};">${today}</td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Card -->
          <tr>
            <td style="background-color: ${CARD}; border: 1px solid ${INK_100}; border-radius: 18px; padding: 40px 36px; box-shadow: 0 2px 18px rgba(27, 24, 20, 0.04);">
              <!-- Wordmark -->
              <p style="margin: 0 0 4px; font-family: ${SERIF}; font-size: 40px; line-height: 1; letter-spacing: -0.015em; color: ${INK_900};">Pod Life</p>
              <p style="margin: 0 0 28px; font-family: ${SERIF}; font-size: 18px; font-style: italic; color: ${TERRACOTTA};">I want what you want.</p>

              ${eyebrow}
              <h1 style="margin: 0 0 18px; font-family: ${SERIF}; font-style: italic; font-size: 28px; line-height: 1.15; color: ${INK_900}; font-weight: 400;">${escapeHtml(content.headline)}</h1>

              ${bodyParas}
              ${feature}
              ${postscript}
            </td>
          </tr>
          <!-- Colophon -->
          <tr>
            <td align="center" style="padding: 22px 4px 0; font-family: ${MONO}; font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: ${INK_300};">
              Built with care
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/**
 * Big monospaced code block — used for the sign-in code email. The dash is
 * baked in so the visible chunks read as letter-pair-of-three. We don't
 * include a copy button (no email client supports JS) but the text is
 * selectable.
 */
export function renderCodeFeature(displayCode: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td align="center">
        <div style="display: inline-block; padding: 22px 32px; background-color: ${PARCHMENT}; border: 1px solid ${INK_100}; border-radius: 14px; font-family: ${MONO}; font-size: 34px; letter-spacing: 0.22em; color: ${INK_900}; font-weight: 600;">${escapeHtml(displayCode)}</div>
      </td>
    </tr>
  </table>`;
}

/**
 * Plain-text counterpart so clients that prefer text/plain (and a few
 * spam filters) get the same content in legible form.
 */
export function renderLetterText(content: LetterContent): string {
  const lines: string[] = [];
  lines.push('Pod Life — I want what you want.');
  lines.push('');
  if (content.eyebrow) lines.push(content.eyebrow.toUpperCase());
  lines.push(content.headline);
  lines.push('');
  for (const p of content.body) lines.push(p);
  if (content.feature) {
    lines.push('');
    // We can't render HTML in text, so this is the caller's job — they
    // pass plain text via the body for the code itself. The feature is a
    // visual flourish only.
  }
  if (content.postscript) {
    lines.push('');
    lines.push(content.postscript);
  }
  return lines.join('\n');
}
