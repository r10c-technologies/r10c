import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Badge, Chip } from './badge.js';

describe('Badge', () => {
  it('is neutral unless told otherwise', () => {
    render(<Badge>Nuevo</Badge>);

    expect(screen.getByText('Nuevo')).toHaveAttribute('data-tone', 'neutral');
  });

  it.each([
    ['accent', 'bg-accent'],
    ['success', 'bg-primary'],
    ['danger', 'bg-danger'],
  ] as const)('paints a %s badge with %s', (tone, className) => {
    render(<Badge tone={tone}>Agotado</Badge>);

    expect(screen.getByText('Agotado')).toHaveClass(className);
  });
});

describe('Chip', () => {
  it('is plain text without a link', () => {
    render(<Chip>LED</Chip>);

    expect(screen.getByText('LED').tagName).toBe('SPAN');
  });

  it('is a link when it narrows a listing', () => {
    render(<Chip href="/es/search?brand=b-1">Aurora</Chip>);

    expect(screen.getByRole('link', { name: 'Aurora' })).toHaveAttribute(
      'href',
      '/es/search?brand=b-1',
    );
  });
});
