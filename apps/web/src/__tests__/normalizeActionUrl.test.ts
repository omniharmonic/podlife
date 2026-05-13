/**
 * Unit tests for the actionUrl normalizer used by NotificationCard.
 *
 * The normalizer's job is to take whatever the API stored — which may be a
 * relative path (correct, going forward) or a legacy fully-qualified URL —
 * and produce a path React Router can navigate via SPA <Link to>. It also
 * rewrites the legacy /schedule/cycles/:id and /schedule paths to the real
 * /schedule/review page, since those never existed as routes.
 *
 * jsdom's default `window.location.origin` is 'http://localhost:3000'; we
 * use that as the same-origin baseline.
 */
import { describe, it, expect } from 'vitest';
import { normalizeActionUrl } from '@/pages/HomePage';

describe('normalizeActionUrl', () => {
  it('passes a clean relative path through unchanged', () => {
    expect(normalizeActionUrl('/partners')).toBe('/partners');
    expect(normalizeActionUrl('/pods/abc-123')).toBe('/pods/abc-123');
    expect(normalizeActionUrl('/schedule/review')).toBe('/schedule/review');
  });

  it('strips a same-origin absolute URL down to a path', () => {
    const sameOrigin = `${window.location.origin}/partners`;
    expect(normalizeActionUrl(sameOrigin)).toBe('/partners');
  });

  it('preserves search + hash when stripping same-origin', () => {
    const url = `${window.location.origin}/pods/abc?tab=chat#last`;
    expect(normalizeActionUrl(url)).toBe('/pods/abc?tab=chat#last');
  });

  it('rewrites legacy /schedule/cycles/:id → /schedule/review', () => {
    // Bare relative form.
    expect(normalizeActionUrl('/schedule/cycles/11111111-2222-3333-4444-555555555555')).toBe(
      '/schedule/review',
    );
    // With a trailing slash.
    expect(normalizeActionUrl('/schedule/cycles/abc/')).toBe('/schedule/review');
    // Same-origin absolute form (the exact shape the bug produced).
    const url = `${window.location.origin}/schedule/cycles/abc-123`;
    expect(normalizeActionUrl(url)).toBe('/schedule/review');
  });

  it('rewrites the legacy /schedule (exact) → /schedule/review', () => {
    expect(normalizeActionUrl('/schedule')).toBe('/schedule/review');
    expect(normalizeActionUrl(`${window.location.origin}/schedule`)).toBe(
      '/schedule/review',
    );
  });

  it('leaves /schedule/review unaffected (it is the real route)', () => {
    expect(normalizeActionUrl('/schedule/review')).toBe('/schedule/review');
  });

  it('passes foreign-origin absolute URLs through unchanged', () => {
    // External links (e.g. a future "open in Telegram web" link) shouldn't be
    // mangled — let the Link component treat them as external.
    expect(normalizeActionUrl('https://example.com/somewhere')).toBe(
      'https://example.com/somewhere',
    );
  });

  it('does not rewrite a path that just contains "/schedule/cycles" as a substring', () => {
    // Regression guard against an over-eager regex.
    expect(normalizeActionUrl('/pods/schedule/cycles-overview')).toBe(
      '/pods/schedule/cycles-overview',
    );
  });
});
