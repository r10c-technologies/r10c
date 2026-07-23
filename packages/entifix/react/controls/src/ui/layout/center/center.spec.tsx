import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Center } from './center.js';

const el = () => screen.getByTestId('center');
const classesOf = () => el().className.split(/\s+/);

describe('Center', () => {
  it('centers and caps to the measure token by default', () => {
    render(<Center data-testid="center" />);
    expect(classesOf()).toEqual(
      expect.arrayContaining(['mx-auto', 'max-w-[var(--measure)]']),
    );
    expect(el().style.getPropertyValue('--measure')).toBe('');
  });

  it('overrides the measure via an inline custom property', () => {
    render(<Center data-testid="center" measure="40ch" />);
    expect(el().style.getPropertyValue('--measure')).toBe('40ch');
  });

  it('adds gutters and intrinsic centering when asked', () => {
    render(<Center data-testid="center" gutters intrinsic />);
    expect(classesOf()).toEqual(
      expect.arrayContaining(['px-s', 'flex', 'flex-col', 'items-center']),
    );
  });

  it('renders the polymorphic element and keeps caller className', () => {
    render(<Center as="main" data-testid="center" className="custom" />);
    expect(el().tagName).toBe('MAIN');
    expect(classesOf()).toContain('custom');
  });
});
