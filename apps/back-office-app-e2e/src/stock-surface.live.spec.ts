import {
  baseTest as test,
  expect,
  seedSession,
} from '@entifix/testing-e2e/playwright';

/**
 * The stock surface against the real fleet: a real session, the app's own
 * `/api/stock` proxy, and stock-service reading `stock_hardware-store`.
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
 * screen. Alan is the hardware store's member.
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

/**
 * Seeded by stock-service from the hardware store's catalog (#676): the wall
 * anchors, `product-offering-7`, a lone receipt of 40, and nothing has held
 * any. A list names it by its offering (#552), so the row is found by that
 * name.
 */
const SEEDED = {
  offeringId: 'product-offering-7',
  name: 'Taco de expansión ¼", bolsa de 25',
  onHand: 40,
};

/**
 * A *different* seeded offering for the write journey below, the switches,
 * `product-offering-8`.
 *
 * The read journey asserts an exact seeded total, so nothing may move
 * `product-offering-7` or the next run reads a number one receipt out of date.
 */
const WRITEABLE = {
  offeringId: 'product-offering-8',
  name: 'Apagador sencillo con placa',
};

type Page = import('@playwright/test').Page;

/**
 * The stock list, ordered by the offering it is for, descending.
 *
 * ⚠️ The list opens on what is running out (#555), which puts a seeded total
 * wherever its availability falls, often past the first page. Sorted by
 * `Producto` — the offering id — descending, `product-offering-9`, `-8` and
 * `-7` are the first three rows. Ascending would open on the `e2e-*` offerings
 * stock-service's live suite leaves behind, which sort before `product-…`.
 */
const openByOffering = async (page: Page) => {
  await page.goto('/stock/stock-item');
  const header = page.getByRole('columnheader', { name: /^Producto/ });
  await header.getByRole('button').click();
  await expect(header).toHaveAttribute('aria-sort', 'ascending');
  await header.getByRole('button').click();
  await expect(header).toHaveAttribute('aria-sort', 'descending');
};

/** A row named by its offering's **cell**, not by substring. */
const rowFor = (page: Page, name: string) =>
  page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name, exact: true }) });

/** What the list currently says this offering holds. */
const onHandOf = async (page: Page, name: string): Promise<number> => {
  // By its header rather than its position: which columns lead a row is the
  // table's to decide — since entifix 0.22.3 the record's own id is gone and a
  // nameless row opens by its noun and short id (#594).
  const headers = await page
    .locator('thead:visible th')
    .evaluateAll(cells => cells.map(cell => (cell.textContent ?? '').trim()));
  const column = headers.findIndex(header => header.startsWith('En almacén'));
  const cells = rowFor(page, name).locator('th, td');
  // A quantity is shown with its unit since ADR 0082 (`40 u.`), formatted for
  // es-GT: the digits are the figure.
  return Number((await cells.nth(column).innerText()).replace(/[^\d.-]/g, ''));
};

test.beforeEach(async ({ context }) => {
  await seedSession(context, { identifier: VENDOR });
});

test('shows a vendor their stock under Operaciones', async ({ page }) => {
  await openByOffering(page);

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
  await expect(rowFor(page, SEEDED.name)).toBeVisible();
  expect(await onHandOf(page, SEEDED.name)).toBe(SEEDED.onHand);
});

test('will not let a vendor type a quantity', async ({ page }) => {
  await openByOffering(page);
  await rowFor(page, SEEDED.name).getByRole('link').first().click();

  await expect(page.getByText(SEEDED.name).first()).toBeVisible();

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
  await openByOffering(page);
  const before = await onHandOf(page, WRITEABLE.name);

  // Started the way the product workspace starts it (#564): with the offering
  // already chosen, by the address.
  await page.goto(
    `/stock/stock-movement/new?prefill.offeringId=${WRITEABLE.offeringId}`,
  );
  // The unit first: a quantity means nothing without it, so the field stays
  // disabled until one is chosen (ADR 0082 §2).
  // Retried: a choice made before the form hydrates is reset by it.
  const unit = page.getByRole('combobox', { name: 'Unidad' });
  await expect(async () => {
    await unit.selectOption({ label: 'Unidad' });
    await expect(unit).toHaveValue('UN', { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
  await page.getByLabel('Cantidad').fill('7');
  await page.getByLabel('Motivo').selectOption('receipt');
  await page.getByRole('button', { name: 'Guardar' }).click();
  // Back on the ledger once the write answered; leaving earlier aborts it.
  await page.waitForURL(/\/stock\/stock-movement$/);

  // The movement is the only write in this domain, and the fold follows it —
  // by `$inc` over the ledger, never by a save of the item.
  await openByOffering(page);
  await expect.poll(() => onHandOf(page, WRITEABLE.name)).toBe(before + 7);
});

test('addresses a stock record as an operation in the workspace', async ({
  page,
}) => {
  await page.goto('/stock/stock-item');

  // Each sidebar item folds its actions into one menu (entifix 0.20.0).
  await page
    .getByRole('button', { name: 'Opciones de Existencias en almacén' })
    .click();
  await page
    .getByRole('menuitem', { name: 'Abrir en el espacio de trabajo' })
    .click();

  await expect(page).toHaveURL(/tab=operation%3Astock-item/);
  await expect(
    page.getByRole('columnheader', { name: 'En almacén' }),
  ).toBeVisible();
  // The tab opens on the list's own opening sort (#555): the seed holds sold-out
  // positions, so the first row is one, and says so in words.
  await expect(
    page.locator('tbody tr').first().locator('[data-tone="danger"]'),
  ).toHaveText('Sin existencias disponibles');
});
