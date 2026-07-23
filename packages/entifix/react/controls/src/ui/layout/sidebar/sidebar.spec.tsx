import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Sidebar } from './sidebar.js';

const classesOf = (id: string) => screen.getByTestId(id).className.split(/\s+/);

describe('Sidebar', () => {
  it('is a wrapping flex row with medium gap by default', () => {
    render(<Sidebar data-testid="root" />);
    expect(classesOf('root')).toEqual(
      expect.arrayContaining(['flex', 'flex-wrap', 'gap-m']),
    );
    expect(classesOf('root')).not.toContain('flex-row-reverse');
  });

  it('reverses when the side sits at the end', () => {
    render(<Sidebar data-testid="root" side="end" gap="l" />);
    expect(classesOf('root')).toEqual(
      expect.arrayContaining(['flex-row-reverse', 'gap-l']),
    );
  });

  it('renders the side and main flush when gap is none', () => {
    render(<Sidebar data-testid="root" gap="none" />);
    expect(classesOf('root')).not.toContain('gap-m');
    expect(classesOf('root').some(c => c.startsWith('gap-'))).toBe(false);
  });

  it('renders the polymorphic root and keeps caller className', () => {
    render(<Sidebar as="section" data-testid="root" className="custom" />);
    expect(screen.getByTestId('root').tagName).toBe('SECTION');
    expect(classesOf('root')).toContain('custom');
  });

  describe('Sidebar.Side', () => {
    it('uses the default fixed basis and no width var', () => {
      render(<Sidebar.Side data-testid="side" />);
      expect(classesOf('side')).toEqual(
        expect.arrayContaining([
          'grow',
          'shrink',
          'basis-[var(--_side-width,20rem)]',
        ]),
      );
      expect(
        screen.getByTestId('side').style.getPropertyValue('--_side-width'),
      ).toBe('');
    });

    it('overrides the width via an inline custom property', () => {
      render(
        <Sidebar.Side
          as="aside"
          data-testid="side"
          width="16rem"
          className="c"
        />,
      );
      const side = screen.getByTestId('side');
      expect(side.tagName).toBe('ASIDE');
      expect(side.style.getPropertyValue('--_side-width')).toBe('16rem');
      expect(classesOf('side')).toContain('c');
    });
  });

  describe('Sidebar.Main', () => {
    it('grows aggressively and keeps a minimum inline size', () => {
      render(<Sidebar.Main data-testid="main" />);
      expect(classesOf('main')).toEqual(
        expect.arrayContaining([
          'grow-[999]',
          'shrink',
          'basis-0',
          'min-w-[var(--_content-min,50%)]',
        ]),
      );
      expect(
        screen.getByTestId('main').style.getPropertyValue('--_content-min'),
      ).toBe('');
    });

    it('overrides the content minimum via an inline custom property', () => {
      render(
        <Sidebar.Main
          as="main"
          data-testid="main"
          contentMin="60%"
          className="c"
        />,
      );
      const main = screen.getByTestId('main');
      expect(main.tagName).toBe('MAIN');
      expect(main.style.getPropertyValue('--_content-min')).toBe('60%');
      expect(classesOf('main')).toContain('c');
    });
  });
});
