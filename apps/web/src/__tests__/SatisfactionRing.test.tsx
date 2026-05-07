import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SatisfactionRing } from '@/components/ui/SatisfactionRing';

// The ring renders the number and "%" as adjacent spans (the % is dimmer
// and smaller). Match the outer SPAN whose combined text content is the
// expected percent — and assert no descendant span has the same content,
// so we pick exactly one element.
const percentSpan = (content: string) =>
  (_: string, node: Element | null) =>
    node !== null &&
    node.tagName === 'SPAN' &&
    node.textContent?.replace(/\s+/g, '') === content &&
    !Array.from(node.children).some(
      (c) => c.textContent?.replace(/\s+/g, '') === content,
    );

describe('SatisfactionRing', () => {
  it('renders the percentage rounded', () => {
    render(<SatisfactionRing pct={73.4} />);
    expect(screen.getByText(percentSpan('73%'))).toBeInTheDocument();
  });

  it('clamps percentages above 100', () => {
    render(<SatisfactionRing pct={250} />);
    expect(screen.getByText(percentSpan('100%'))).toBeInTheDocument();
  });

  it('clamps percentages below 0', () => {
    render(<SatisfactionRing pct={-25} />);
    expect(screen.getByText(percentSpan('0%'))).toBeInTheDocument();
  });

  it('renders an optional label', () => {
    render(<SatisfactionRing pct={50} label="Alex" />);
    expect(screen.getByText('Alex')).toBeInTheDocument();
  });

  it('hides percentage when compact', () => {
    render(<SatisfactionRing pct={50} compact />);
    expect(screen.queryByText(percentSpan('50%'))).not.toBeInTheDocument();
  });
});
