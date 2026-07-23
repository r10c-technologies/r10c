import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Cover } from './cover.js';

const classesOf = (id: string) => screen.getByTestId(id).className.split(/\s+/);

describe('Cover', () => {
  it('is a vertical flex with a full-viewport minimum by default', () => {
    render(<Cover data-testid="root" />);
    expect(classesOf('root')).toEqual(
      expect.arrayContaining([
        'flex',
        'flex-col',
        'min-h-[var(--_cover-min,100vh)]',
        'gap-m',
      ]),
    );
    expect(
      screen.getByTestId('root').style.getPropertyValue('--_cover-min'),
    ).toBe('');
  });

  it('overrides the minimum height via an inline custom property', () => {
    render(
      <Cover
        as="section"
        data-testid="root"
        minHeight="60vh"
        gap="l"
        className="c"
      />,
    );
    const root = screen.getByTestId('root');
    expect(root.tagName).toBe('SECTION');
    expect(root.style.getPropertyValue('--_cover-min')).toBe('60vh');
    expect(classesOf('root')).toEqual(expect.arrayContaining(['gap-l', 'c']));
  });

  it('centers the main and passes through header/footer slots', () => {
    render(
      <Cover data-testid="root">
        <Cover.Header data-testid="header" className="h">
          Head
        </Cover.Header>
        <Cover.Main as="main" data-testid="main" className="m">
          Body
        </Cover.Main>
        <Cover.Footer as="footer" data-testid="footer" className="f">
          Foot
        </Cover.Footer>
      </Cover>,
    );
    expect(classesOf('main')).toEqual(expect.arrayContaining(['my-auto', 'm']));
    expect(screen.getByTestId('main').tagName).toBe('MAIN');
    expect(classesOf('header')).toContain('h');
    expect(screen.getByTestId('footer').tagName).toBe('FOOTER');
    expect(classesOf('footer')).toContain('f');
  });
});
