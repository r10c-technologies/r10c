import type { ThemePalette } from '@entifix/react-controls';

import ocean from './ocean.palette.json';

/**
 * The palettes the back office offers, brand first: the account menu lists
 * them, the root layout reads a stored choice against them, and the screen
 * gate measures every screen in each (#530).
 */
export const THEME_IDS = ['ocean', 'midnight'] as const;

export const DEFAULT_THEME = 'ocean';

/** Dense operator work, until the reader chooses otherwise. */
export const DEFAULT_DENSITY = 'compact';

/** The cookie `ThemeProvider` keeps the choice in, read by the root layout. */
export const THEME_STORAGE_KEY = 'r10c-admin-theme';

/**
 * The brand palette, registered from data rather than shipped as a CSS
 * preset. Its values live in JSON so `tools/conventions/src/palettes.spec.ts`
 * holds them to entifix ADR 0025's contrast pairs without importing a client
 * module.
 */
export const RUNTIME_PALETTES: Record<string, ThemePalette> = { ocean };

/**
 * The runtime palettes as CSS, for the root layout to render with the page.
 * `ThemeProvider` would inject the same rules only after hydration, so a
 * stored `ocean` first painted in the default tokens and then changed.
 */
export const runtimePaletteCss = (): string =>
  Object.entries(RUNTIME_PALETTES)
    .map(([id, palette]) => {
      const declarations = Object.entries(palette)
        .map(([token, value]) => `--color-${token}: ${String(value)};`)
        .join(' ');
      return `[data-theme='${id}'] { ${declarations} }`;
    })
    .join('\n');
