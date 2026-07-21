import { act, render, renderHook, screen } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ThemeProvider, useTheme } from './theme-context.js';
import type { ThemeOption } from './types.js';

const themes: ThemeOption[] = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

const wrapper =
  (props: Partial<Parameters<typeof ThemeProvider>[0]> = {}) =>
  ({ children }: PropsWithChildren) => (
    <ThemeProvider themes={themes} {...props}>
      {children}
    </ThemeProvider>
  );

beforeEach(() => {
  window.localStorage.clear();
  delete document.documentElement.dataset['theme'];
});

afterEach(() => {
  document.getElementById('r10c-theme-runtime-palettes')?.remove();
});

describe('ThemeProvider', () => {
  it('starts on the first declared theme', () => {
    const { result } = renderHook(() => useTheme(), { wrapper: wrapper() });

    expect(result.current.theme).toBe('light');
    expect(result.current.themes).toBe(themes);
  });

  it('honours an explicit default', () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: wrapper({ defaultTheme: 'dark' }),
    });

    expect(result.current.theme).toBe('dark');
  });

  it('falls back to an empty theme when none were declared', () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: ({ children }: PropsWithChildren) => (
        <ThemeProvider themes={[]}>{children}</ThemeProvider>
      ),
    });

    expect(result.current.theme).toBe('');
  });

  it('reflects the active theme onto the document', () => {
    renderHook(() => useTheme(), { wrapper: wrapper({ defaultTheme: 'dark' }) });

    expect(document.documentElement.dataset['theme']).toBe('dark');
  });

  it('persists the active theme', () => {
    renderHook(() => useTheme(), { wrapper: wrapper({ defaultTheme: 'dark' }) });

    expect(window.localStorage.getItem('r10c-theme')).toBe('dark');
  });

  it('namespaces persistence by the given storage key', () => {
    renderHook(() => useTheme(), {
      wrapper: wrapper({ storageKey: 'admin-theme', defaultTheme: 'dark' }),
    });

    expect(window.localStorage.getItem('admin-theme')).toBe('dark');
  });

  // Hydration runs in an effect on purpose: localStorage does not exist during
  // SSR, so the server renders the default and the client corrects after mount.
  // Reading it during render would be a hydration mismatch.
  it('adopts a previously stored preference on mount', () => {
    window.localStorage.setItem('r10c-theme', 'dark');

    const { result } = renderHook(() => useTheme(), { wrapper: wrapper() });

    expect(result.current.theme).toBe('dark');
  });

  it.each([
    ['an unknown theme id', 'solarized'],
    ['no stored value at all', null],
  ])('ignores %s in storage', (_label, stored) => {
    if (stored !== null) window.localStorage.setItem('r10c-theme', stored);

    const { result } = renderHook(() => useTheme(), { wrapper: wrapper() });

    expect(result.current.theme).toBe('light');
  });

  it('switches theme through setTheme, reflecting and persisting it', () => {
    const { result } = renderHook(() => useTheme(), { wrapper: wrapper() });

    act(() => result.current.setTheme('dark'));

    expect(result.current.theme).toBe('dark');
    expect(document.documentElement.dataset['theme']).toBe('dark');
    expect(window.localStorage.getItem('r10c-theme')).toBe('dark');
  });

  describe('runtime palettes', () => {
    // White-label palettes are injected last in the cascade so they override a
    // static preset defining the same tokens.
    it('injects a style element under the theme selector', () => {
      renderHook(() => useTheme(), {
        wrapper: wrapper({ palettes: { dark: { primary: '#000', accent: '#fff' } } }),
      });

      const style = document.getElementById('r10c-theme-runtime-palettes');
      expect(style?.textContent).toContain("[data-theme='dark']");
      expect(style?.textContent).toContain('--color-primary: #000;');
      expect(style?.textContent).toContain('--color-accent: #fff;');
    });

    // A second provider mount must find and rewrite the existing element; a
    // fresh one per mount would leave stale palettes stacked in <head>.
    it('reuses the existing style element rather than stacking them', () => {
      renderHook(() => useTheme(), {
        wrapper: wrapper({ palettes: { dark: { primary: '#000' } } }),
      });

      renderHook(() => useTheme(), {
        wrapper: wrapper({ palettes: { dark: { primary: '#111' } } }),
      });

      expect(
        document.querySelectorAll('#r10c-theme-runtime-palettes'),
      ).toHaveLength(1);
      expect(
        document.getElementById('r10c-theme-runtime-palettes')?.textContent,
      ).toContain('#111');
    });

    it.each([
      ['no palettes', undefined],
      ['an empty palette map', {}],
    ])('injects nothing for %s', (_label, palettes) => {
      renderHook(() => useTheme(), { wrapper: wrapper({ palettes }) });

      expect(document.getElementById('r10c-theme-runtime-palettes')).toBeNull();
    });
  });
});

describe('useTheme', () => {
  // Without a provider there is no `data-theme` to flip, so a component using
  // the hook would silently render unthemed.
  it('fails outside a ThemeProvider', () => {
    expect(() => renderHook(() => useTheme())).toThrow(
      /must be used within a ThemeProvider/,
    );
  });

  it('is available to any descendant', () => {
    const Consumer = () => <span>{useTheme().theme}</span>;
    render(
      <ThemeProvider themes={themes} defaultTheme="dark">
        <div>
          <Consumer />
        </div>
      </ThemeProvider>,
    );

    expect(screen.getByText('dark')).toBeInTheDocument();
  });
});
