import { seedSession } from '@entifix/testing-e2e/playwright';
import type { Page } from '@playwright/test';
import { http, HttpResponse } from 'msw';

import {
  expect,
  PAID_ORDER_ID,
  STOCK_SERVICE_URL,
  test,
} from './support/fixtures';

/**
 * The vendor's home (#563, ADR 0077): what needs them today, each count one
 * activation from where it is resolved. Each tile is its own slice shell's,
 * read through that shell's adapter, so a tile that fails stands alone.
 */
const tiles = (page: Page) =>
  page.getByRole('list', { name: 'Pendientes de hoy' }).getByRole('listitem');

/** Every domain a vendor home reads, orders among them. */
const PROVISIONED = [
  'product-configuration-management',
  'stock-management',
  'settlement-management',
  'shipping-order-management',
  'order-management',
];

test.beforeEach(async ({ context }) => {
  await seedSession(context, { roles: ['admin'], entitlements: PROVISIONED });
});

test('a vendor sees what needs them today, with the seeded counts', async ({
  page,
}) => {
  await page.goto('/es/home');

  // Two shipments wait for dispatch, one position has nothing to sell, and
  // the next run pays Q 125.50.
  await expect(
    page.getByRole('link', { name: /Envíos por despachar.*2/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Productos agotados.*1/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Su próximo pago.*(?<!GT)Q\s125\.50/ }),
  ).toBeVisible();
  // And the latest order, one activation from its own record.
  const orders = tiles(page).filter({ hasText: 'Últimos pedidos' });
  await expect(
    orders.locator(`a[href$="/order/product-order/${PAID_ORDER_ID}"]`),
  ).toBeVisible();
});

test('the dispatch tile leads to the worklist it counts', async ({ page }) => {
  await page.goto('/es/home');
  await page.getByRole('link', { name: /Envíos por despachar/ }).click();

  await page.waitForURL(/\/fulfilment\/shipping-order$/);
  await expect(page).toHaveURL(/\/fulfilment\/shipping-order$/);
});

test('a stock read that fails leaves the other tiles standing', async ({
  page,
  network,
}) => {
  network.use(
    http.get(
      `${STOCK_SERVICE_URL}/stock-item`,
      () => new HttpResponse(null, { status: 500 }),
    ),
  );
  await page.goto('/es/home');

  // The failed tile says so in place and offers its Retry...
  await expect(
    tiles(page).filter({ hasText: 'Productos agotados' }).getByRole('button'),
  ).toBeVisible();
  // ...and the others are still there to activate.
  const dispatch = page.getByRole('link', { name: /Envíos por despachar.*2/ });
  await dispatch.focus();
  await expect(dispatch).toBeFocused();
  await expect(
    page.getByRole('link', { name: /Su próximo pago/ }),
  ).toBeVisible();
});

test('an organization not provisioned to ship has no dispatch tile', async ({
  page,
  context,
}) => {
  await seedSession(context, {
    roles: ['admin'],
    entitlements: ['stock-management', 'settlement-management'],
  });
  await page.goto('/es/home');

  await expect(
    page.getByRole('link', { name: /Productos agotados/ }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: /Envíos por despachar/ }),
  ).toHaveCount(0);
});

test('an operator, acting for no organization, sees no tile', async ({
  page,
  context,
}) => {
  await seedSession(context, {
    roles: ['super-admin'],
    activeOrganizationId: null,
    partyRole: 'operator',
    entitlements: [],
  });
  await page.goto('/es/home');

  await expect(
    page.getByText(
      'Cuando actúe por una organización, aquí verá lo que requiere su atención.',
    ),
  ).toBeVisible();
  await expect(
    page.getByRole('list', { name: 'Pendientes de hoy' }),
  ).toHaveCount(0);
});
