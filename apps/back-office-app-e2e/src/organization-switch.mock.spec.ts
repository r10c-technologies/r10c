import { http, HttpResponse } from 'msw';

import {
  APP_URL,
  DEMO_MEMBERSHIP,
  expect,
  switches,
  test,
} from './support/fixtures';

/**
 * The organization switcher (#527): shown only to a member of two or more,
 * listing them with the current one marked, and a choice posts the switch
 * and reloads under the new session.
 */
test.beforeEach(() => {
  switches.length = 0;
});

test('shows no switcher to a member of one organization', async ({ page }) => {
  await page.goto('/es/catalog/product-brand');

  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(
    page.getByRole('button', { name: /^Organización:/ }),
  ).toHaveCount(0);
});

test('switches to another of the caller’s organizations', async ({
  page,
  network,
}) => {
  network.use(
    http.get(`${APP_URL}/api/auth/memberships`, () =>
      HttpResponse.json({
        items: [
          DEMO_MEMBERSHIP,
          {
            organizationId: 'second-organization',
            name: 'Second Vendor',
            isDefault: false,
            current: false,
          },
        ],
      }),
    ),
  );
  await page.goto('/es/catalog/product-brand');

  await page.getByRole('button', { name: 'Organización: Demo Vendor' }).click();
  const dialog = page.getByRole('dialog', { name: 'Cambiar de organización' });
  await expect(
    dialog.getByRole('button', { name: /Demo Vendor/ }),
  ).toBeDisabled();

  const reloaded = page.waitForEvent('framenavigated');
  await dialog.getByRole('button', { name: 'Second Vendor' }).click();
  await reloaded;

  expect(switches).toEqual(['second-organization']);
});
