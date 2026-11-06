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
