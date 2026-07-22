import { expect, test } from '@playwright/test';

// Smoke check only: the home page renders its heading.
test('renders the landing heading', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('h1')).toBeVisible();
});
