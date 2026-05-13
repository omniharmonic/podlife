import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { LOGIN_CODE_LENGTH, LOGIN_CODE_TTL_MINUTES } from '@pod-life/shared';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Flourish } from '@/components/ui/Flourish';
import { auth } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { isPasskeySupported, signInWithPasskey } from '@/lib/passkeys';

type Status =
  | { kind: 'idle' }
  /** `email` null while still requesting the very first code (no code step
   *  visible yet); set during a resend so the code step stays mounted. */
  | { kind: 'requesting'; email: string | null }
  | { kind: 'awaiting'; email: string }
  | { kind: 'verifying'; email: string }
  | { kind: 'error'; email: string | null; message: string };

const FOUNDED_YEAR = new Date().getFullYear();
const TODAY_FMT = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
}).format(new Date());

/**
 * Landing page — designed as a printed correspondence.
 *
 * Voice ground rules (see .claude/pod-life-brand-voice.md):
 *  - Lead with love, not logistics. The first thing read is care.
 *  - Tagline is "I want what you want." — a polycule's animating principle.
 *  - Avoid "scheduling," "optimize," "fair" as the lead concept.
 *
 * Layout: a single centered column, paced like reading a letter. The logo
 * is treated as an embossed seal at the top; the tagline is the largest
 * type on the page; sign-in is the quiet practical close at the bottom.
 */
export function LoginPage() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const codeInputRef = useRef<HTMLInputElement | null>(null);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const passkeySupported = isPasskeySupported();

  /**
   * Where to send the user after successful sign-in. Honors `?next=<path>`
   * (used by the invite landing page) but only if it's a same-origin
   * relative path — guards against open-redirect via `//evil.com` or
   * `http://evil.com` values. New users go through /onboarding by default,
   * but a `next=/join/...` invite link takes precedence so a cold invitee
   * lands back on the invite page to accept rather than being detoured
   * through onboarding.
   */
  function destinationAfterSignIn(onboardedAt: string | null): string {
    const next = searchParams.get('next');
    if (next && next.startsWith('/') && !next.startsWith('//')) return next;
    return onboardedAt ? '/home' : '/onboarding';
  }

  // Focus the code input the moment we transition to the awaiting step so
  // the iOS one-time-code suggestion bar can pop up immediately.
  useEffect(() => {
    if (status.kind === 'awaiting') {
      codeInputRef.current?.focus();
    }
  }, [status.kind]);

  async function onRequestCode(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    setStatus({ kind: 'requesting', email: null });
    setCode('');
    try {
      await auth.requestLoginCode(trimmed);
      setStatus({ kind: 'awaiting', email: trimmed });
    } catch (err) {
      setStatus({
        kind: 'error',
        email: null,
        message:
          err instanceof Error
            ? err.message
            : "Couldn't send the code. Try again?",
      });
    }
  }

  async function onVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    if (status.kind !== 'awaiting' && status.kind !== 'error') return;
    const target =
      status.kind === 'awaiting' ? status.email : (status.email ?? email.trim());
    if (!target) return;
    const cleaned = code.replace(/[\s-_]/g, '').toUpperCase();
    if (cleaned.length < LOGIN_CODE_LENGTH) return;
    setStatus({ kind: 'verifying', email: target });
    try {
      const result = await auth.verify(target, cleaned);
      login(result.sessionToken, result.person);
      navigate(destinationAfterSignIn(result.person.onboardedAt ?? null), {
        replace: true,
      });
    } catch (err) {
      setStatus({
        kind: 'error',
        email: target,
        message:
          err instanceof Error
            ? err.message
            : 'That code didn\'t match. Try again, or send a new one.',
      });
      setCode('');
      requestAnimationFrame(() => codeInputRef.current?.focus());
    }
  }

  function backToEmail() {
    setStatus({ kind: 'idle' });
    setCode('');
  }

  async function onPasskey() {
    if (passkeyBusy) return;
    setPasskeyBusy(true);
    try {
      const trimmed = email.trim() || undefined;
      const result = await signInWithPasskey(trimmed);
      if (result.status === 'signed-in') {
        login(result.sessionToken, result.person);
        navigate(destinationAfterSignIn(result.person.onboardedAt ?? null), {
          replace: true,
        });
        return;
      }
      if (result.status === 'error') {
        setStatus({ kind: 'error', email: trimmed ?? null, message: result.message });
      }
      // 'cancelled' is a quiet no-op — user closed the system prompt.
    } finally {
      setPasskeyBusy(false);
    }
  }

  async function resendCode() {
    if (status.kind !== 'awaiting' && status.kind !== 'error') return;
    const target = status.email;
    if (!target) return;
    setStatus({ kind: 'requesting', email: target });
    try {
      await auth.requestLoginCode(target);
      setStatus({ kind: 'awaiting', email: target });
      setCode('');
    } catch (err) {
      setStatus({
        kind: 'error',
        email: target,
        message:
          err instanceof Error
            ? err.message
            : "Couldn't send a new code. Try again?",
      });
    }
  }

  // The code step stays mounted across `requesting` (resend) so the input
  // doesn't unmount mid-flight; only the very first request (email===null)
  // keeps the email step visible.
  const showCodeStep =
    status.kind === 'awaiting' ||
    status.kind === 'verifying' ||
    (status.kind === 'requesting' && status.email !== null) ||
    (status.kind === 'error' && status.email !== null);
  const errorMessage = status.kind === 'error' ? status.message : undefined;
  const resendDisabled = status.kind === 'requesting';

  return (
    <div className="relative min-h-screen flex flex-col bg-parchment overflow-hidden">
      {/* Soft paper grain — subtle dual radial wash to add depth without imagery. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-0 opacity-70"
        style={{
          backgroundImage:
            'radial-gradient(ellipse 60% 50% at 50% 0%, rgba(194, 91, 63, 0.06), transparent 60%), ' +
            'radial-gradient(ellipse 80% 60% at 50% 100%, rgba(129, 178, 154, 0.05), transparent 60%)',
        }}
      />

      {/* Masthead — like the dateline of a letter. */}
      <header className="relative z-10 px-6 sm:px-10 pt-6 sm:pt-8 flex items-center justify-between max-w-5xl mx-auto w-full">
        <span className="eyebrow text-ink-400">Pod Life · Vol. {FOUNDED_YEAR - 2025 || 'I'}</span>
        <span className="eyebrow text-ink-400 hidden sm:inline">{TODAY_FMT}</span>
      </header>

      <main className="relative z-10 flex-1 flex items-center justify-center px-6 py-10 sm:py-16">
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.32, 0.72, 0, 1] }}
          className="w-full max-w-xl flex flex-col items-center text-center"
        >
          {/* Logo seal — the visual anchor */}
          <motion.div
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.7, delay: 0.05, ease: [0.32, 0.72, 0, 1] }}
            className="relative mb-6"
          >
            <div
              aria-hidden="true"
              className="absolute inset-0 -m-3 rounded-full"
              style={{
                background:
                  'radial-gradient(circle at 50% 40%, rgba(194,91,63,0.10), transparent 65%)',
              }}
            />
            <img
              src="/podlife_logo_alpha.png"
              alt="Pod Life"
              width={160}
              height={160}
              className="relative block w-32 h-32 sm:w-40 sm:h-40 object-contain drop-shadow-[0_2px_18px_rgba(27,24,20,0.12)]"
            />
          </motion.div>

          {/* The wordmark is the typographic anchor — uprights, generous,
              the page asserts what it is before saying anything else. */}
          <motion.h1
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.12 }}
            className="font-display text-ink-900 text-[3.4rem] sm:text-[5.5rem] leading-[0.95] tracking-[-0.015em] mb-2"
            style={{ fontVariationSettings: "'opsz' 144, 'SOFT' 50, 'wght' 380" }}
          >
            Pod Life
          </motion.h1>

          {/* The tagline — italic subhead that names the principle. */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.22 }}
            className="font-display italic text-ink-600 text-2xl sm:text-3xl leading-[1.15] tracking-[-0.005em]"
            style={{ fontVariationSettings: "'opsz' 60, 'SOFT' 70, 'wght' 360" }}
          >
            I want what you want.
          </motion.p>

          <Flourish variant="laurel" className="w-32 h-7 text-ink-300 my-7" />

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.32 }}
            className="text-ink-700 max-w-md mb-2 leading-[1.7] text-[15.5px]"
          >
            Care infrastructure for the people who love more than one person —
            and want to actually show up for all of them.
          </motion.p>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.42 }}
            className="text-ink-500 max-w-md mb-12 leading-[1.7] text-[14.5px] italic"
          >
            Tell us what kind of time matters with each person.
            We'll find a plan where everyone gets cared for.
          </motion.p>

          {/* Sign-in form — quiet practical close.
              Two steps: email → 6-character code. The code path works the
              same in the browser, in an installed PWA, or after the email
              opens Safari and the user comes back to the home-screen icon. */}
          {showCodeStep ? (
            <motion.form
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              onSubmit={onVerifyCode}
              className="w-full max-w-sm flex flex-col gap-6 border-t border-b border-ink-200/60 py-8"
            >
              <div>
                <p
                  className="font-display italic text-3xl text-ink-800 mb-3"
                  style={{ fontVariationSettings: "'opsz' 60, 'SOFT' 60, 'wght' 440" }}
                >
                  A letter is on its way
                </p>
                <p className="text-sm text-ink-600 mb-1 leading-relaxed">
                  We've sent a {LOGIN_CODE_LENGTH}-character code to
                </p>
                <p className="font-mono text-[13px] text-ink-800 tracking-wide break-all">
                  {'email' in status ? (status.email ?? '') : ''}
                </p>
              </div>

              <Input
                ref={codeInputRef}
                type="text"
                name="code"
                label="Type or paste the code"
                autoComplete="one-time-code"
                inputMode="text"
                placeholder="ABC-DEF"
                required
                value={code}
                onChange={(e) => setCode(e.currentTarget.value)}
                maxLength={LOGIN_CODE_LENGTH + 4}
                spellCheck={false}
                autoCapitalize="characters"
                error={errorMessage}
                hint={`Expires in ${LOGIN_CODE_TTL_MINUTES} minutes — like most good things.`}
                style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  fontSize: '20px',
                }}
              />

              <Button
                type="submit"
                size="lg"
                fullWidth
                loading={status.kind === 'verifying'}
                disabled={
                  code.replace(/[\s\-_]/g, '').length < LOGIN_CODE_LENGTH ||
                  status.kind === 'verifying'
                }
              >
                Sign in
              </Button>

              <div className="flex items-center justify-between text-[13px]">
                <button
                  type="button"
                  onClick={resendCode}
                  className="text-ink-500 hover:text-ink-700 underline-offset-4 hover:underline disabled:opacity-50"
                  disabled={resendDisabled}
                >
                  {resendDisabled ? 'Sending…' : 'Send a new code'}
                </button>
                <button
                  type="button"
                  onClick={backToEmail}
                  className="text-ink-500 hover:text-ink-700 underline-offset-4 hover:underline"
                >
                  Use a different address
                </button>
              </div>
            </motion.form>
          ) : (
            <motion.form
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.5 }}
              onSubmit={onRequestCode}
              className="w-full max-w-sm flex flex-col gap-7"
            >
              <Input
                type="email"
                name="email"
                label="Where should we write?"
                autoComplete="email"
                inputMode="email"
                placeholder="you@somewhere.kind"
                required
                value={email}
                onChange={(e) => setEmail(e.currentTarget.value)}
                error={
                  status.kind === 'error' && status.email === null
                    ? status.message
                    : undefined
                }
                hint="No password, no app account — we'll send a code to type in."
              />
              <Button
                type="submit"
                size="lg"
                fullWidth
                loading={status.kind === 'requesting'}
                disabled={!email.trim() || status.kind === 'requesting'}
              >
                Send the code
              </Button>

              {passkeySupported && (
                <>
                  <div className="flex items-center gap-3 my-1 text-ink-300">
                    <span className="flex-1 h-px bg-ink-200/70" />
                    <span className="text-[10px] uppercase tracking-[0.18em]">
                      or
                    </span>
                    <span className="flex-1 h-px bg-ink-200/70" />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="lg"
                    fullWidth
                    onClick={onPasskey}
                    loading={passkeyBusy}
                  >
                    Sign in with a passkey
                  </Button>
                </>
              )}
            </motion.form>
          )}

          {/* Pull quote — closing line of the letter */}
          <motion.figure
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.7, delay: 0.7 }}
            className="mt-20 max-w-md"
          >
            <blockquote
              className="text-ink-500 italic text-[15px] leading-[1.7]"
              style={{ fontFamily: 'Instrument Serif, serif' }}
            >
              "We make time for what we love by being honest
              about how little of it we have."
            </blockquote>
            <figcaption className="mt-3 eyebrow text-ink-400">
              — From the Pod Life almanac
            </figcaption>
          </motion.figure>
        </motion.div>
      </main>

      {/* Small footer — colophon */}
      <footer className="relative z-10 px-6 sm:px-10 pb-6 max-w-5xl mx-auto w-full text-center sm:text-left">
        <p className="eyebrow text-ink-300">
          Built with care · {TODAY_FMT}
        </p>
      </footer>
    </div>
  );
}
