import { expect } from '@playwright/test';

import { test } from './support/fixtures';

/**
 * The one check that catches a screen wired to no provider at all.
 *
 * A component holding an untranslated literal still *renders* — lint and the
 * typed-key gate cover authored copy, but neither can tell whether the tree a
 * route actually mounts sits under `I18nProvider`. Only asking for the same
 * screen in two locales and seeing the words change proves it does.
 */

test.describe('switching locale', () => {
  test('serves the same screen in the negotiated language', async ({
    page,
  }) => {
    await page.goto('/es/catalog/product-brand');
    const nav = page.getByRole('navigation');
    // `.first()` because each entry renders twice — the page link and its
    // "open in workspace" sibling.
    await expect(nav.getByRole('link', { name: 'Marcas' }).first()).toBeVisible();

    await page.goto('/en/catalog/product-brand');
    await expect(nav.getByRole('link', { name: 'Brands' }).first()).toBeVisible();
  });

  test('sends an unprefixed path to the default locale', async ({ page }) => {
    await page.goto('/catalog/product-brand');

    await expect(page).toHaveURL(/\/es\/catalog\/product-brand$/);
  });
});
