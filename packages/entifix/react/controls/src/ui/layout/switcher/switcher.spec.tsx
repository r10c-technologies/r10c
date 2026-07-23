import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Switcher } from './switcher.js';

const el = () => screen.getByTestId('switcher');
const classesOf = () => el().className.split(/\s+/);

describe('Switcher', () => {
  it('is a wrapping flex row that distributes children equally by default', () => {
    render(<Switcher data-testid="switcher" />);
    expect(classesOf()).toEqual(
      expect.arrayContaining([
        'flex',
        'flex-wrap',
        'gap-m',
        '[&>*]:grow',
        '[&>*]:basis-[calc((var(--_threshold,30rem)_-_100%)_*_999)]',
      ]),
    );
    expect(el().style.getPropertyValue('--_threshold')).toBe('');
  });

  it('overrides the threshold via an inline custom property', () => {
    render(<Switcher data-testid="switcher" threshold="40rem" gap="l" />);
    expect(el().style.getPropertyValue('--_threshold')).toBe('40rem');
    expect(classesOf()).toContain('gap-l');
  });

  it('renders the polymorphic element and keeps caller className', () => {
    render(<Switcher as="ul" data-testid="switcher" className="custom" />);
    expect(el().tagName).toBe('UL');
    expect(classesOf()).toContain('custom');
  });
});
