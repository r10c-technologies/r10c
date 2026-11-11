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
 * Every gated screen's accepted violations, each against the issue that
 * removes it (ADR 0075). `A11Y_BASELINE=update pnpm nx e2e
 * @r10c/back-office-app-e2e` rewrites it; a new entry then has an empty owner,
 * which `@r10c/conventions` refuses until one is named. CI refuses a pull
 * request that adds an entry.
 */
export const BASELINE = join(__dirname, 'a11y-baseline.json');

/**
 * The keyboard walk's limits, at ADR 0075's targets: a skip link is the first
 * stop, and `main` is reached within three, because the sidebar is one stop
 * per navigation group (entifix's `BackOfficeShell`, #527). `maxStops` bounds
 * a whole screen's walk.
 */
export const WALK: WalkOptions = {
  skipLink: true,
  mainIndexMax: 3,
  maxStops: 90,
};

/** The palettes a back-office screen is gated in: the brand and the dark one. */
export const PALETTES = ['ocean', 'midnight'] as const;

/**
 * Opens every page of the context in `palette`, as a stored preference: the
 * first-party cookie `ThemeProvider` keeps the choice in since entifix 0.20.0,
 * set before any page script runs.
 */
export const usePalette = (page: Page, palette: string) =>
  page.addInitScript(id => {
    document.cookie = `r10c-admin-theme=${encodeURIComponent(id)}; path=/; samesite=lax`;
  }, palette);

/** The screen gate: axe against the baseline, then the keyboard walk. */
export const expectAccessible = async (page: Page, screen: string) => {
  await expect(page.locator('main:visible')).toBeVisible();
  await expectNoNewA11yViolations(page, { screen, baselinePath: BASELINE });
  await walkKeyboard(page, WALK);
};

/**
 * WCAG 3.2.6, consistent help: where a help mechanism exists, it sits in the
 * same relative order on every screen. The position of the first link named
 * as help among the page's links, or `null` when there is none.
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

/**
 * Asserts 3.2.6 across the positions one walk of the screens collected: every
 * screen agrees, and a run with no help mechanism anywhere is recorded as not
 * applicable rather than passed silently.
 */
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
