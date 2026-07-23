import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Grid } from './grid.js';

const el = () => screen.getByTestId('grid');
const classesOf = () => el().className.split(/\s+/);

describe('Grid', () => {
  it('is an auto-fill grid keyed off the grid-min token by default', () => {
    render(<Grid data-testid="grid" />);
    expect(classesOf()).toEqual(
      expect.arrayContaining([
        'grid',
        'grid-cols-[repeat(auto-fill,minmax(min(var(--_grid-min,16rem),100%),1fr))]',
        'gap-m',
      ]),
    );
    expect(el().style.getPropertyValue('--_grid-min')).toBe('');
  });

  it('overrides the minimum column width via an inline custom property', () => {
    render(<Grid data-testid="grid" min="12rem" gap="l" />);
    expect(el().style.getPropertyValue('--_grid-min')).toBe('12rem');
    expect(classesOf()).toContain('gap-l');
  });

  it('renders the polymorphic element and keeps caller className', () => {
    render(<Grid as="ul" data-testid="grid" className="custom" />);
    expect(el().tagName).toBe('UL');
    expect(classesOf()).toContain('custom');
  });
});
