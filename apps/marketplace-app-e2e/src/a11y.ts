// `usePalette` and `helpPosition` hand closures to the browser, so this file is
// checked against the DOM's types as well.
/// <reference lib="dom" />
import { join } from 'node:path';

import {
  expectNoNewA11yViolations,
  walkKeyboard,
  type WalkOptions,
} from '@entifix/testing-e2e/a11y';
import { expect, type Page, test } from '@playwright/test';

/**
 * Every gated storefront screen's accepted violations, each against the issue
 * that removes it (ADR 0075). `A11Y_BASELINE=update pnpm nx e2e
 * @r10c/marketplace-app-e2e` rewrites it; a new entry then has an empty owner,
 * which `@r10c/conventions` refuses until one is named. CI refuses a pull
 * request that adds an entry.
 */
export const BASELINE = join(__dirname, 'a11y-baseline.json');

/** The storefront runs at the targets: a skip link first, main within 3. */
export const WALK: WalkOptions = { skipLink: true, mainIndexMax: 3 };

/** The storefront's two palettes. */
export const PALETTES = ['marketplace', 'marketplace-dark'] as const;

/** Opens every page of the context in `palette`, as a stored preference. */
export const usePalette = (page: Page, palette: string) =>
  page.addInitScript(id => {
    window.localStorage.setItem('r10c-marketplace-theme', id);
  }, palette);

/** The screen gate: axe against the baseline, then the keyboard walk. */
export const expectAccessible = async (page: Page, screen: string) => {
  await expect(page.locator('main:visible')).toBeVisible();
  await expectNoNewA11yViolations(page, { screen, baselinePath: BASELINE });
  await walkKeyboard(page, WALK);
};

/**
 * WCAG 3.2.6, consistent help: the position of the first link named as help
 * among the page's links, or `null` when there is none.
 */
export const helpPosition = (page: Page) =>
  page.evaluate(() => {
    const links = [...document.querySelectorAll('a[href], button')];
    const at = links.findIndex(link =>
      /\b(ayuda|help|soporte|support)\b/i.test(
        link.getAttribute('aria-label') ?? link.textContent ?? '',
      ),
    );
    return at === -1 ? null : at;
  });

/** Every screen agrees on where help is, or none offers it (not applicable). */
export const expectConsistentHelp = (positions: readonly (number | null)[]) => {
  if (positions.every(position => position === null)) {
    test.info().annotations.push({
      type: 'wcag 3.2.6',
      description: 'not applicable: no screen offers a help mechanism',
    });
    return;
  }
  expect(new Set(positions).size, 'help moves between screens').toBe(1);
};
