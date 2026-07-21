import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { type SpacingToken, Stack } from './stack.js';

const classesOf = () => screen.getByTestId('stack').className.split(/\s+/);

describe('Stack', () => {
  it('is a column with medium spacing by default', () => {
    render(<Stack data-testid="stack" />);

    expect(classesOf()).toEqual(
      expect.arrayContaining(['flex', 'flex-col', 'gap-m', 'items-stretch']),
    );
  });

  it('lays out in a row on request', () => {
    render(<Stack data-testid="stack" direction="row" />);

    expect(classesOf()).toContain('flex-row');
    expect(classesOf()).not.toContain('flex-col');
  });

  // The gap classes are a static lookup rather than a template string, because
  // Tailwind's scanner cannot see a class it never finds in the source.
  it.each([
    '3xs',
    '2xs',
    'xs',
    's',
    'm',
    'l',
    'xl',
    '2xl',
    '3xl',
  ] as SpacingToken[])('maps the %s spacing token', (gap) => {
    render(<Stack data-testid="stack" gap={gap} />);

    expect(classesOf()).toContain(`gap-${gap}`);
  });

  it.each([
    ['start', 'items-start'],
    ['center', 'items-center'],
    ['end', 'items-end'],
    ['stretch', 'items-stretch'],
  ] as const)('maps align %s', (align, expected) => {
    render(<Stack data-testid="stack" align={align} />);

    expect(classesOf()).toContain(expected);
  });

  it('wraps only when asked', () => {
    render(<Stack data-testid="stack" wrap />);
    expect(classesOf()).toContain('flex-wrap');
  });

  it('does not wrap by default', () => {
    render(<Stack data-testid="stack" />);
    expect(classesOf()).not.toContain('flex-wrap');
  });

  it('keeps the caller’s className and children', () => {
    render(
      <Stack data-testid="stack" className="custom">
        Contents
      </Stack>,
    );

    expect(classesOf()).toContain('custom');
    expect(screen.getByTestId('stack')).toHaveTextContent('Contents');
  });
});
