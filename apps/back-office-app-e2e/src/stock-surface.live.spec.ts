import {
  baseTest as test,
  expect,
  seedSession,
} from '@r10c/entifix-ts-testing-e2e/playwright';

/**
 * The stock surface against the real fleet: a real session, the app's own
 * `/api/stock` proxy, and stock-service reading `stock_demo-organization`.
 *
 * The mock suite beside this one asserts the same affordances against stubbed
 * descriptors, which is what makes it hermetic and what bounds it: it cannot
 * tell whether the proxy path, the httpOnly session cookie and the service's
 * own guards actually agree. Three things have to line up for a page here to
 * render a row, and only a live run exercises all three.
 *
 * ⚠️ **Alan, not Ada, and not by preference.** Ada is platform staff and holds
 * no membership, so her token carries no `activeOrganizationId` — every tenant
 * read answers `409 noActiveOrganization`, which looks exactly like a broken
 * screen. Alan is the demo organization's member.
 *
 * ⚠️ It also depends on the organization being **provisioned** for the domain.
 * The stock nav items are `entitled: true`, so ADR 0007's second ceiling hides
 * the section from an organization whose entitlement does not name
 * `stock-management` — no error, no empty state, just no section. That is the
 * defect this file caught before it existed, and the assertion below is what
 * keeps it caught.
 *
 * `baseTest` rather than the project fixtures: those install msw handlers for
 * the catalog, which is exactly what a live run must not have.
 */

const VENDOR = 'alan@example.com';

/** Seeded by stock-service: a lone receipt of ten, and nothing has held any. */
const SEEDED = { offeringId: 'product-offering-1', onHand: 10 };

/**
 * A *different* seeded offering for the write journey below.
 *
 * The read journey asserts an exact seeded total, so nothing may move
 * `product-offering-1` or the next run reads a number one receipt out of date.
 * Both sit on the list's first page, so neither needs a filter to be reached.
 */
const WRITEABLE = 'product-offering-9';

/**
 * A row named by its **cell**, not by substring.
 *
 * ⚠️ `hasText: 'product-offering-1'` also matches `product-offering-10` through
 * `-19`, which is a strict-mode violation live and silently the wrong row on a
 * store holding fewer of them.
 */
const rowFor = (page: import('@playwright/test').Page, offeringId: string) =>
  page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: offeringId, exact: true }) });

/** What the list currently says this offering holds. */
const onHandOf = async (
  page: import('@playwright/test').Page,
  offeringId: string,
): Promise<number> => {
  const cells = rowFor(page, offeringId).getByRole('cell');
  // id, offeringId, onHand, reserved, actions — the column order the entity's
  // own accessor metadata produces.
  return Number(await cells.nth(2).innerText());
};

test.beforeEach(async ({ context }) => {
  await seedSession(context, { identifier: VENDOR });
});

test('shows a vendor their stock under Operaciones', async ({ page }) => {
  await page.goto('/stock/stock-item');

  const operations = page.getByRole('group', { name: 'Operaciones' });
  await expect(operations).toBeVisible();
  await expect(
    operations.getByRole('link', {
      name: 'Existencias en almacén',
      exact: true,
    }),
  ).toBeVisible();

  // A named row with the total its ledger implies — the assertion that would
  // pass against an empty store if it said "some row exists" instead.
  await expect(rowFor(page, SEEDED.offeringId)).toBeVisible();
  expect(await onHandOf(page, SEEDED.offeringId)).toBe(SEEDED.onHand);
});

test('will not let a vendor type a quantity', async ({ page }) => {
  await page.goto('/stock/stock-item');
  await rowFor(page, SEEDED.offeringId).getByRole('link').first().click();

  await expect(page.getByText(SEEDED.offeringId)).toBeVisible();

  // The real `$metadata`, from the real service, filtered by the real
  // principal: `stock-item` answers `["read"]` because no role holds
  // `stock-item:write` and there is no save route. So there is nothing to type
  // into and nothing to submit — which is what keeps an absolute-quantity write
  // out of the system (ADR 0010).
  await expect(page.getByRole('spinbutton')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Guardar' })).toHaveCount(0);
});

test('records a receipt and moves the total by exactly that much', async ({
  page,
}) => {
  // ⚠️ A **relative** assertion against a seeded row, rather than an absolute
  // one against a fresh offering. A live store is not reset between runs, so an
  // absolute figure is one receipt out of date the second time this runs — and
  // a fresh offering lands on a later page of a list that ignores a `rsql`
  // query parameter, so the row was simply not on screen.
  await page.goto('/stock/stock-item');
  const before = await onHandOf(page, WRITEABLE);

  await page.goto('/stock/stock-movement/new');
  await page.getByLabel('ID de oferta').fill(WRITEABLE);
  await page.getByLabel('Cantidad').fill('7');
  await page.getByLabel('Motivo').selectOption('receipt');
  await page.getByRole('button', { name: 'Guardar' }).click();

  // The movement is the only write in this domain, and the fold follows it —
  // by `$inc` over the ledger, never by a save of the item.
  await page.goto('/stock/stock-item');
  await expect.poll(() => onHandOf(page, WRITEABLE)).toBe(before + 7);
});

test('addresses a stock record as an operation in the workspace', async ({
  page,
}) => {
  await page.goto('/stock/stock-item');

  await page
    .getByRole('link', {
      name: 'Abrir Existencias en almacén en el espacio de trabajo',
    })
    .click();

  await expect(page).toHaveURL(/tab=operation%3Astock-item/);
  await expect(
    page.getByRole('columnheader', { name: 'En almacén' }),
  ).toBeVisible();
  await expect(rowFor(page, SEEDED.offeringId)).toBeVisible();
});
