import { expect, test } from '@playwright/test';

/**
 * The one check that catches a screen wired to no provider at all.
 *
 * A component holding an untranslated literal still *renders* — lint and the
 * typed-key gate cover authored copy, but neither can tell whether the tree a
 * route actually mounts sits under `I18nProvider`. Only asking for the same
 * screen in two locales and seeing the words change proves it does.
 */

test.describe('switching locale', () => {
  test('serves the storefront in the negotiated language', async ({ page }) => {
    await page.goto('/es');
    await expect(page.getByText('Añadir al carrito').first()).toBeVisible();

    await page.goto('/en');
    await expect(page.getByText('Add to cart').first()).toBeVisible();
  });

  // Nothing pins `r10c_locale` here, so an unprefixed path falls through to
  // `Accept-Language`, which is the browser's to set.
  test.describe('an unprefixed path', () => {
    test.use({ locale: 'en-US' });
    test('follows Accept-Language', async ({ page }) => {
      await page.goto('/');

      await expect(page).toHaveURL(/\/en$/);
    });
  });

  test.describe('an unprefixed path with no usable Accept-Language', () => {
    test.use({ locale: 'de-DE' });
    test('falls back to the default locale', async ({ page }) => {
      await page.goto('/');

      await expect(page).toHaveURL(/\/es$/);
    });
  });
});
