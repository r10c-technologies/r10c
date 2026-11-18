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

/**
 * Opens every page of the context in `palette`, as a stored preference: the
 * first-party cookie `ThemeProvider` keeps the choice in since entifix 0.20.0,
 * set before any page script runs.
 */
export const usePalette = (page: Page, palette: string) =>
  page.addInitScript(id => {
    document.cookie = `r10c-marketplace-theme=${encodeURIComponent(id)}; path=/; samesite=lax`;
  }, palette);

/**
 * Every id an ARIA reference names, used more than once on the page.
 *
 * ⚠️ **axe does not gate this.** Its `duplicate-id-aria` rule is
 * `reviewOnFail`, so a duplicate lands among the *incomplete* results and
 * never among the violations the baseline reads. That is how two cached home
 * strips shipped cards announcing each other's names (#726): each strip ran
 * `useId` from the same start.
 */
export const duplicateReferencedIds = (page: Page) =>
  page.evaluate(() => {
    const ATTRIBUTES = [
      'aria-labelledby',
      'aria-describedby',
      'aria-controls',
      'aria-owns',
      'aria-activedescendant',
      'for',
    ];
    // Rendered elements only: Next keeps earlier routes in the document under
    // `display: none`, and a hidden page repeating an id is not on screen.
    const rendered = (element: Element) => element.checkVisibility();
    const referenced = new Set(
      [...document.querySelectorAll('*')]
        .filter(rendered)
        .flatMap(element =>
          ATTRIBUTES.flatMap(name =>
            (element.getAttribute(name) ?? '').split(/\s+/).filter(Boolean),
          ),
        ),
    );
    return [...referenced].filter(
      id =>
        [...document.querySelectorAll(`[id="${CSS.escape(id)}"]`)].filter(
          rendered,
        ).length > 1,
    );
  });

/**
 * The screen gate: axe against the baseline, every ARIA reference resolving to
 * one element, then the keyboard walk.
 */
export const expectAccessible = async (page: Page, screen: string) => {
  await expect(page.locator('main:visible')).toBeVisible();
  await expectNoNewA11yViolations(page, { screen, baselinePath: BASELINE });
  expect(
    await duplicateReferencedIds(page),
    `${screen}: an ARIA reference names an id that is not unique`,
  ).toEqual([]);
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
