import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ButtonLink } from './button-link';

describe('ButtonLink', () => {
  it('renders an anchor, not a button', () => {
    render(<ButtonLink href="/p/aurora-desk-lamp">View product</ButtonLink>);

    const link = screen.getByRole('link', { name: 'View product' });
    expect(link).toHaveAttribute('href', '/p/aurora-desk-lamp');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('wears the same variants as Button', () => {
    render(
      <ButtonLink href="/cart" variant="secondary" size="lg">
        Cart
      </ButtonLink>,
    );

    const link = screen.getByRole('link', { name: 'Cart' });
    expect(link.className).toContain('border-border');
    expect(link.className).toContain('text-step-1');
  });

  it('keeps caller classes alongside the recipe', () => {
    render(
      <ButtonLink href="/" className="w-full">
        Home
      </ButtonLink>,
    );

    const link = screen.getByRole('link', { name: 'Home' });
    expect(link.className).toContain('w-full');
    expect(link.className).toContain('bg-primary');
  });
});
