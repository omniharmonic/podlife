/**
 * Basic accessibility smoke tests.
 *
 * These tests assert structural a11y properties we control directly:
 * - Headings exist and form a sensible hierarchy
 * - Icon-only buttons carry aria-label
 * - Decorative SVGs are aria-hidden
 * - Interactive elements are reachable as buttons/links via getByRole
 *
 * For deeper auditing (color contrast, full WCAG), see apps/web/A11Y.md
 * which documents manual audit findings. Adding @axe-core/react would be a
 * future improvement once the build is stable.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { WelcomePage } from '@/pages/WelcomePage';
import { LoginPage } from '@/pages/LoginPage';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';

function renderWithRouter(ui: React.ReactElement, route = '/welcome') {
  return render(
    <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>,
  );
}

describe('a11y: WelcomePage', () => {
  it('has exactly one h1 (page title)', () => {
    renderWithRouter(<WelcomePage />);
    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
  });

  it('h1 contains the product name and audience', () => {
    renderWithRouter(<WelcomePage />);
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1.textContent?.toLowerCase()).toContain('relationship scheduling');
    expect(h1.textContent?.toLowerCase()).toContain('polyamorous families');
  });

  it('exposes "Sign in" link/button reachable by role', () => {
    renderWithRouter(<WelcomePage />);
    expect(
      screen.getByRole('button', { name: /sign in/i }),
    ).toBeInTheDocument();
  });

  it('decorative SVGs are aria-hidden', () => {
    const { container } = renderWithRouter(<WelcomePage />);
    const svgs = container.querySelectorAll('svg');
    // Every SVG on the welcome page is decorative.
    svgs.forEach((svg) => {
      expect(svg.getAttribute('aria-hidden')).toBe('true');
    });
  });

  it('all section headings have accessible labels', () => {
    renderWithRouter(<WelcomePage />);
    const h2s = screen.getAllByRole('heading', { level: 2 });
    expect(h2s.length).toBeGreaterThanOrEqual(3);
    h2s.forEach((h) => {
      expect(h.textContent?.trim().length).toBeGreaterThan(0);
    });
  });
});

describe('a11y: LoginPage', () => {
  it('has an h1 and a labeled email input', () => {
    renderWithRouter(<LoginPage />, '/login');
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    const email = screen.getByLabelText(/email/i);
    expect(email).toBeInTheDocument();
    expect(email).toHaveAttribute('type', 'email');
  });

  it('submit button is reachable by role and accessible name', () => {
    renderWithRouter(<LoginPage />, '/login');
    const button = screen.getByRole('button', { name: /send sign-in link/i });
    expect(button).toBeInTheDocument();
  });
});

describe('a11y: shared components', () => {
  it('EmptyState renders semantic heading', () => {
    render(<EmptyState title="Nothing here yet" description="Try something" />);
    expect(screen.getByRole('heading', { name: /nothing here yet/i })).toBeInTheDocument();
  });

  it('Button keeps accessible focus ring class', () => {
    render(<Button>Click me</Button>);
    const btn = screen.getByRole('button', { name: /click me/i });
    expect(btn.className).toMatch(/focus-visible:ring/);
  });

  it('Button passes aria-label through for icon-only usage', () => {
    render(<Button aria-label="Dismiss notification">{''}</Button>);
    const btn = screen.getByRole('button', { name: /dismiss notification/i });
    expect(btn).toBeInTheDocument();
  });
});

describe('a11y: structural sweep over WelcomePage links', () => {
  it('all anchor tags have either visible text or aria-label', () => {
    const { container } = renderWithRouter(<WelcomePage />);
    const links = container.querySelectorAll('a');
    links.forEach((a) => {
      const accessibleName =
        a.getAttribute('aria-label') ?? a.textContent?.trim();
      expect(accessibleName).toBeTruthy();
    });
  });

  it('GitHub external link points to repo', () => {
    renderWithRouter(<WelcomePage />);
    const githubLinks = screen.getAllByRole('link', { name: /github/i });
    expect(githubLinks.length).toBeGreaterThan(0);
    expect(
      githubLinks.some((l) =>
        l.getAttribute('href')?.includes('github.com/omniharmonic/pod-life'),
      ),
    ).toBe(true);
  });
});

describe('a11y: WelcomePage heading hierarchy', () => {
  it('does not skip from h1 to h3', () => {
    renderWithRouter(<WelcomePage />);
    // We have h1 and h2s; the only h3s appear inside cards under h2 sections.
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toBeInTheDocument();
    const h3s = screen.queryAllByRole('heading', { level: 3 });
    if (h3s.length > 0) {
      // If any h3 exists, it must be preceded by an h2 in the document.
      const h2s = screen.getAllByRole('heading', { level: 2 });
      expect(h2s.length).toBeGreaterThan(0);
      const firstH2 = h2s[0];
      const firstH3 = h3s[0];
      if (firstH2 && firstH3) {
        const all = Array.from(document.querySelectorAll('*'));
        const firstH2Index = all.indexOf(firstH2);
        const firstH3Index = all.indexOf(firstH3);
        expect(firstH3Index).toBeGreaterThan(firstH2Index);
      }
    }
  });
});

describe('a11y: testimonial uses semantic blockquote', () => {
  it('blockquote element is present', () => {
    const { container } = renderWithRouter(<WelcomePage />);
    expect(container.querySelector('blockquote')).not.toBeNull();
  });

  // Sanity: footer is a landmark.
  it('footer element is present', () => {
    const { container } = renderWithRouter(<WelcomePage />);
    expect(container.querySelector('footer')).not.toBeNull();
  });

  it('main hero CTA "Get started" is a button', () => {
    renderWithRouter(<WelcomePage />);
    expect(
      screen.getByRole('button', { name: /get started/i }),
    ).toBeInTheDocument();
  });

  // Verify within a section to test `within` import.
  it('how-it-works section exposes step headings', () => {
    renderWithRouter(<WelcomePage />);
    const heading = screen.getByRole('heading', { name: /how it works/i });
    const section = heading.closest('section');
    if (section) {
      const stepHeadings = within(section).getAllByRole('heading', {
        level: 3,
      });
      expect(stepHeadings.length).toBe(3);
    }
  });
});
