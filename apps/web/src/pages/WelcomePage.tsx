import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/Button';
import { Flourish } from '@/components/ui/Flourish';
import { DropCap } from '@/components/ui/DropCap';

/**
 * Public marketing/landing page at `/welcome`.
 * Editorial layout — feels like the cover of a literary journal,
 * not a SaaS landing.
 */
export function WelcomePage() {
  return (
    <div className="min-h-screen bg-parchment text-ink-800">
      {/* Header */}
      <header className="max-w-5xl mx-auto px-6 pt-8 flex items-baseline justify-between">
        <Link
          to="/welcome"
          className="flex items-baseline gap-2 select-none focus:outline-none focus-visible:ring-1 focus-visible:ring-ink rounded"
        >
          <span
            className="font-display italic text-ink-800 text-2xl leading-none"
            style={{ fontVariationSettings: "'opsz' 60, 'SOFT' 60, 'wght' 440" }}
          >
            Pod Life
          </span>
          <span className="font-mono uppercase text-[0.6rem] tracking-[0.2em] text-ink-400">
            vol. i
          </span>
        </Link>
        <Link to="/login">
          <Button variant="ghost" size="sm">
            Sign in
          </Button>
        </Link>
      </header>

      {/* Hero */}
      <section className="max-w-4xl mx-auto px-6 py-20 sm:py-28 text-center">
        <motion.p
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="eyebrow mb-6"
        >
          Open-source · Self-hostable · Privacy-first
        </motion.p>
        <motion.h1
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.32, 0.72, 0, 1] }}
          className="font-display italic text-ink-900 text-5xl sm:text-7xl leading-[1.02] tracking-tight mb-8"
          style={{ fontVariationSettings: "'opsz' 144, 'SOFT' 80, 'wght' 360" }}
        >
          I want
          <br />
          <span className="text-terracotta-600">what you want.</span>
        </motion.h1>

        <Flourish variant="laurel" className="w-44 h-8 text-ink-300 mx-auto my-8" />

        <p className="text-lg text-ink-700 max-w-2xl mx-auto mb-10 leading-[1.7] italic">
          A small instrument for the people who love more than one person —
          and want to actually show up for all of them. Tell us what kind of
          time matters with each one. We'll find a plan where everyone gets
          cared for.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 items-center justify-center">
          <Link to="/login">
            <Button size="lg">Get started — it's free</Button>
          </Link>
          <a
            href="https://github.com/omniharmonic/pod-life"
            target="_blank"
            rel="noreferrer"
            className="focus:outline-none focus-visible:ring-1 focus-visible:ring-ink rounded"
          >
            <Button variant="ghost" size="lg" leftIcon={<GitHubIcon />}>
              View on GitHub
            </Button>
          </a>
        </div>
      </section>

      <FlourishDivider />

      {/* How it works — three numbered stanzas */}
      <section
        className="max-w-3xl mx-auto px-6 py-20"
        aria-labelledby="how-it-works-heading"
      >
        <p className="eyebrow text-center mb-3">An almanac in three movements</p>
        <h2
          id="how-it-works-heading"
          className="font-display italic text-4xl sm:text-5xl text-center text-ink-800 mb-3"
          style={{ fontVariationSettings: "'opsz' 96, 'SOFT' 60, 'wght' 420' " }}
        >
          How it works
        </h2>
        <p className="text-center text-ink-500 max-w-xl mx-auto mb-14 italic">
          Three movements, from "I have no idea when I'll see them this week"
          to a plan everyone is happy with.
        </p>

        <div className="flex flex-col gap-12">
          <Stanza
            number="i."
            title="Connect your calendar"
            description="Google, Outlook, or your own hand. We read free/busy only — never the names of your meetings or who you saw on Tuesday. Sovereignty and connection live together here."
          />
          <FlourishDivider />
          <Stanza
            number="ii."
            title="Share what kind of time matters"
            description="With each person you love, tell us two things: what you need (the minimum that keeps the relationship feeling cared for) and what you hope for (the version where the week lines up). No primary, no secondary — just what's true for each one."
          />
          <FlourishDivider />
          <Stanza
            number="iii."
            title="Get a plan that fits everyone"
            description="Pod Life suggests a week where the person with the least gets as much as possible. Nobody's left behind. Accept what works; ask to reshuffle what doesn't. You're always in choice."
          />
        </div>
      </section>

      <FlourishDivider />

      {/* Built with care */}
      <section
        className="max-w-4xl mx-auto px-6 py-20"
        aria-labelledby="features-heading"
      >
        <p className="eyebrow text-center mb-3">Marginalia</p>
        <h2
          id="features-heading"
          className="font-display italic text-4xl sm:text-5xl text-center text-ink-800 mb-12"
          style={{ fontVariationSettings: "'opsz' 96, 'SOFT' 60, 'wght' 420" }}
        >
          Built with care
        </h2>
        <div className="grid md:grid-cols-2 gap-x-12 gap-y-10">
          <Feature
            title="Nobody gets left behind"
            description="Under the hood, Pod Life finds the plan where the person with the least is getting as much as possible. Not averaging. Not compromising. Making sure everyone's cared for."
          />
          <Feature
            title="Privacy-first by design"
            description="Defense-in-depth across application logic, database row-level security, and outbound message filters. Other partners can't see each other unless you choose to share."
          />
          <Feature
            title="Open source (AGPL-3.0)"
            description="Every line is auditable. We chose AGPL deliberately: a tool that holds intimate information should be ownable by the communities that use it."
          />
          <Feature
            title="Self-hostable"
            description="Deploy on your own VPS, Railway, or Fly.io with one Docker Compose file. Your data, your infrastructure."
          />
        </div>
      </section>

      <FlourishDivider />

      {/* Testimonial */}
      <section
        className="max-w-3xl mx-auto px-6 py-20 text-center"
        aria-label="Testimonial"
      >
        <blockquote
          className="font-display italic text-3xl sm:text-4xl text-ink-700 leading-[1.3]"
          style={{ fontVariationSettings: "'opsz' 96, 'SOFT' 70, 'wght' 380" }}
        >
          &ldquo;We stopped having the same Sunday-night calendar fight every
          week. That alone was worth it.&rdquo;
        </blockquote>
        <p className="mt-8 eyebrow">— A polycule of four, somewhere</p>
      </section>

      <FlourishDivider />

      {/* CTA */}
      <section className="max-w-3xl mx-auto px-6 py-20 text-center">
        <h2
          className="font-display italic text-4xl sm:text-5xl text-ink-800 mb-5"
          style={{ fontVariationSettings: "'opsz' 96, 'SOFT' 70, 'wght' 400" }}
        >
          Ready to schedule with intention?
        </h2>
        <p className="text-ink-600 italic mb-10 max-w-xl mx-auto leading-relaxed">
          Sign in with email — no password to remember. Connect a calendar in
          under a minute.
        </p>
        <Link to="/login">
          <Button size="lg">Start with your email</Button>
        </Link>
      </section>

      {/* Footer */}
      <footer className="max-w-5xl mx-auto px-6 py-12 text-sm text-ink-500 border-t border-ink-100/60">
        <div className="flex flex-col sm:flex-row gap-4 items-center justify-between">
          <p className="italic">
            Pod Life — built with love, for love. By{' '}
            <a
              href="https://github.com/omniharmonic"
              className="underline decoration-1 underline-offset-4 hover:text-terracotta-600"
              target="_blank"
              rel="noreferrer"
            >
              Benjamin Life
            </a>
            .
          </p>
          <div className="flex gap-6 font-mono uppercase text-[0.7rem] tracking-widest">
            <a
              href="https://github.com/omniharmonic/pod-life"
              className="hover:text-terracotta-600"
              target="_blank"
              rel="noreferrer"
            >
              GitHub
            </a>
            <a
              href="https://github.com/omniharmonic/pod-life/blob/main/LICENSE"
              className="hover:text-terracotta-600"
              target="_blank"
              rel="noreferrer"
            >
              AGPL-3.0
            </a>
            <a
              href="https://github.com/omniharmonic/pod-life/blob/main/SECURITY.md"
              className="hover:text-terracotta-600"
              target="_blank"
              rel="noreferrer"
            >
              Security
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ─── Sub-components ───

interface StanzaProps {
  number: string;
  title: string;
  description: string;
}

function Stanza({ number, title, description }: StanzaProps) {
  return (
    <div className="flex flex-col items-center text-center px-2">
      <span className="font-display italic text-terracotta-600 text-3xl mb-3"
            style={{ fontVariationSettings: "'opsz' 60, 'SOFT' 60, 'wght' 460" }}>
        {number}
      </span>
      <h3
        className="font-display italic text-ink-800 text-2xl sm:text-3xl mb-4"
        style={{ fontVariationSettings: "'opsz' 60, 'SOFT' 50, 'wght' 440" }}
      >
        {title}
      </h3>
      <DropCap className="text-ink-700 max-w-xl">{description}</DropCap>
    </div>
  );
}

interface FeatureProps {
  title: string;
  description: string;
}

function Feature({ title, description }: FeatureProps) {
  return (
    <div className="flex flex-col gap-2">
      <h3
        className="font-display italic text-ink-800 text-xl"
        style={{ fontVariationSettings: "'opsz' 36, 'SOFT' 50, 'wght' 460" }}
      >
        {title}
      </h3>
      <p className="text-sm text-ink-600 leading-[1.7]">{description}</p>
    </div>
  );
}

function FlourishDivider() {
  return (
    <div className="max-w-2xl mx-auto px-6 my-2">
      <Flourish variant="rule" className="w-full text-ink-300" />
    </div>
  );
}

// ─── Icons ───

function GitHubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.9 1.3 1.9 1.3 1.1 1.9 2.9 1.3 3.6 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.3.5-2.4 1.3-3.2-.1-.4-.6-1.6.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.7 1.6.2 2.8.1 3.2.8.8 1.3 1.9 1.3 3.2 0 4.7-2.8 5.7-5.5 6 .4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3" />
    </svg>
  );
}
