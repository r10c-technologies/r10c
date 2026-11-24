/**
 * r10c's own palettes meet entifix ADR 0025's contrast pairs.
 *
 * entifix holds its presets to the pair table; the palettes an app brings —
 * the storefront's `[data-theme]` blocks in `themes.css` and the back office's
 * runtime `ocean` — are r10c's to hold (ADR 0075). Each is checked merged over
 * the defaults in `@entifix/style/tokens.css`, because a block that states
 * only some tokens is painted with the defaults for the rest, and those have
 * to read on the brand's surfaces too.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import {
  assertPaletteContract,
  paletteContractFailures,
  type PaletteValues,
  parsePaletteCss,
} from '@entifix/style/testing';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');

const tokens = createRequire(import.meta.url).resolve(
  '@entifix/style/tokens.css',
);
const defaults = parsePaletteCss(readFileSync(tokens, 'utf8'))['default'];

const storefront = parsePaletteCss(
  readFileSync(
    join(REPO_ROOT, 'apps/marketplace-app/src/app/themes.css'),
    'utf8',
  ),
);

const ocean = JSON.parse(
  readFileSync(
    join(REPO_ROOT, 'apps/back-office-app/src/app/ocean.palette.json'),
    'utf8',
  ),
) as PaletteValues;

const PALETTES: Record<string, PaletteValues> = { ...storefront, ocean };

/** The opacity entifix's filled button recipes fade to on hover. */
const HOVER_OPACITY = 0.9;

/** The filled buttons that fade, each with the token its label is painted in. */
const HOVERED = [
  ['primary', 'primary-content'],
  ['danger', 'danger-content'],
] as const;

const channels = (hex: string) => {
  const value = hex.replace('#', '');
  return [0, 2, 4].map(at => Number.parseInt(value.slice(at, at + 2), 16));
};

/** `fill` at `opacity` over `ground`, as the browser composites it. */
const blend = (fill: string, ground: string, opacity: number) => {
  const under = channels(ground);
  return `#${channels(fill)
    .map((channel, at) =>
      Math.round(opacity * channel + (1 - opacity) * (under[at] ?? 0))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
};

const luminance = (hex: string) => {
  const [r = 0, g = 0, b = 0] = channels(hex).map(channel => {
    const c = channel / 255;
    return c <= 0.039_28 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** One token's value, which a merged palette must state. */
const tokenOf = (palette: PaletteValues, key: string): string => {
  const value = (palette as Record<string, string | undefined>)[key];
  if (value === undefined) throw new Error(`the palette states no ${key}`);
  return value;
};

/** WCAG's contrast ratio between two opaque colours. */
const contrast = (a: string, b: string) => {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05);
};

describe("r10c's palettes meet the token contract", () => {
  it('finds every palette it is meant to check', () => {
    expect(Object.keys(PALETTES).sort()).toEqual([
      'marketplace',
      'marketplace-dark',
      'ocean',
    ]);
  });

  it.each(Object.keys(PALETTES))('%s passes every pair', name => {
    expect(() =>
      assertPaletteContract({ ...defaults, ...PALETTES[name] }, name),
    ).not.toThrow();
  });

  // entifix's filled buttons — primary and destructive — fade to 90% on
  // hover (`hover:opacity-90`), and the pair table checks only the resting
  // fill: the storefront's primary passed at rest and failed hovered (#690).
  it.each(Object.keys(PALETTES))(
    '%s keeps a filled button readable while it is hovered',
    name => {
      const palette: PaletteValues = { ...defaults, ...PALETTES[name] };
      const failures = HOVERED.flatMap(([fill, content]) =>
        ['surface', 'surface-elevated'].flatMap(ground => {
          const hovered = blend(
            tokenOf(palette, fill),
            tokenOf(palette, ground),
            HOVER_OPACITY,
          );
          const ratio = contrast(tokenOf(palette, content), hovered);
          return ratio >= 4.5
            ? []
            : [
                `${content} on ${fill} hovered over ${ground}: ${ratio.toFixed(2)}`,
              ];
        }),
      );
      expect(failures).toEqual([]);
    },
  );

  it('refuses the storefront primary that failed hovered', () => {
    const palette: PaletteValues = {
      ...defaults,
      ...PALETTES['marketplace'],
      primary: '#0c8148',
    };
    const hovered = blend(
      tokenOf(palette, 'primary'),
      tokenOf(palette, 'surface'),
      HOVER_OPACITY,
    );
    expect(contrast(tokenOf(palette, 'primary-content'), hovered)).toBeLessThan(
      4.5,
    );
  });

  // The values these palettes held before they were fixed (#520): a check
  // that passes them is not checking.
  it.each([
    ['marketplace', { primary: '#0f9d58', accent: '#d97706' }],
    ['ocean', { primary: '#0e8a8f' }],
  ] as const)('refuses the old %s values', (name, old) => {
    expect(
      paletteContractFailures({ ...defaults, ...PALETTES[name], ...old }),
    ).not.toEqual([]);
  });
});
