'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import type { ThemeContextValue, ThemeOption, ThemePalette } from './types';

const ThemeContext = createContext<ThemeContextValue | null>(null);

export interface ThemeProviderProps extends PropsWithChildren {
  /** The themes this app exposes. First entry is the default unless
   *  `defaultTheme` is given. Drives `data-theme` + the switcher. */
  themes: ThemeOption[];
  /** Theme id used for the first paint / when nothing is stored. */
  defaultTheme?: string;
  /** localStorage key — namespace it per app so apps don't clobber each other. */
  storageKey?: string;
  /**
   * Runtime palettes for brands not shipped as CSS presets (multi-tenant /
   * white-label). Keyed by theme id; injected as `[data-theme='id']{…}` vars
   * appended after the app stylesheet, so they override static presets.
   */
  palettes?: Record<string, ThemePalette>;
}

/**
 * Applies the active palette by writing `data-theme` on <html> and persisting
 * the choice. Static palette VALUES live in CSS (@r10c/entifix-style presets or
 * an app-local themes.css); this flips the selector. Dynamic palettes passed via
 * `palettes` are injected at runtime under the same `data-theme` mechanism.
 */
export function ThemeProvider({
  children,
  themes,
  defaultTheme,
  storageKey = 'r10c-theme',
  palettes,
}: ThemeProviderProps) {
  const initial = defaultTheme ?? themes[0]?.id ?? '';
  const [theme, setThemeState] = useState<string>(initial);

  const isKnown = useCallback(
    (value: unknown): value is string =>
      typeof value === 'string' && themes.some(t => t.id === value),
    [themes],
  );

  // Hydrate from a previously stored preference on mount.
  useEffect(() => {
    const stored = window.localStorage.getItem(storageKey);
    if (isKnown(stored)) setThemeState(stored);
  }, [storageKey, isKnown]);

  // Inject runtime palettes as a single <style> appended to <head>. Being last
  // in the cascade, these win over any static preset defining the same tokens.
  useEffect(() => {
    if (!palettes || Object.keys(palettes).length === 0) return;
    const styleId = `${storageKey}-runtime-palettes`;
    const css = Object.entries(palettes)
      .map(([id, palette]) => {
        const decls = Object.entries(palette)
          .map(([token, value]) => `--color-${token}: ${value};`)
          .join(' ');
        return `[data-theme='${id}'] { ${decls} }`;
      })
      .join('\n');

    let el = document.getElementById(styleId) as HTMLStyleElement | null;
    if (!el) {
      el = document.createElement('style');
      el.id = styleId;
      document.head.appendChild(el);
    }
    el.textContent = css;
  }, [palettes, storageKey]);

  // Reflect the active theme onto the document + persist it.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(storageKey, theme);
  }, [theme, storageKey]);

  const setTheme = useCallback((next: string) => setThemeState(next), []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, themes }),
    [theme, setTheme, themes],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
