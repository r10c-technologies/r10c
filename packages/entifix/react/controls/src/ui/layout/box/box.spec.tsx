import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { SpacingToken } from '../_shared';
import { Box } from './box.js';

const classesOf = () => screen.getByTestId('box').className.split(/\s+/);

describe('Box', () => {
  it('has medium padding and a themed boundary by default', () => {
    render(<Box data-testid="box" />);
    expect(classesOf()).toEqual(
      expect.arrayContaining([
        'p-m',
        'rounded-md',
        'border',
        'border-border',
        'bg-surface-elevated',
        'text-content',
      ]),
    );
  });

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
  ] as SpacingToken[])('maps the %s padding token', padding => {
    render(<Box data-testid="box" padding={padding} />);
    expect(classesOf()).toContain(`p-${padding}`);
  });

  it('renders the polymorphic element and keeps caller className + children', () => {
    render(
      <Box as="section" data-testid="box" className="custom">
        Contents
      </Box>,
    );
    expect(screen.getByTestId('box').tagName).toBe('SECTION');
    expect(classesOf()).toContain('custom');
    expect(screen.getByTestId('box')).toHaveTextContent('Contents');
  });
});
