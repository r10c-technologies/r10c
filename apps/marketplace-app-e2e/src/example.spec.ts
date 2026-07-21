import { expect, test } from '@playwright/test';

// Smoke check only: the home page renders its heading. The generator's original
// assertion looked for "Welcome", which this landing page never said — it went
// unnoticed because the e2e target could not run at all.
test('renders the landing heading', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('h1')).toBeVisible();
});
