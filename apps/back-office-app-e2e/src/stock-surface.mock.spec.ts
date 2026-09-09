import { expect, test } from './support/fixtures';

/**
 * The stock surface: the first Operaciones screens in the back office.
 *
 * Mock-only, and the reason is the *shape* of what is asserted rather than the
 * data: these journeys are about which affordances the browser renders — a Save
 * that is absent, a quantity that is not an input, a tab addressed
 * `operation:` — and the served descriptors that decide all three are stubbed
 * verbatim from the running service in `fixtures.ts`. The service's own half is
 * `stock-service-e2e`, which runs against real Mongo.
 *
 * ⚠️ Two of these would pass vacuously against an unstubbed backend, so they
 * assert on the seeded rows they name — `product-offering-1` holds ten — rather
 * than on "a row exists".
 */

test('groups the stock screens under Operaciones, not Definiciones', async ({
  page,
}) => {
  await page.goto('/stock/stock-item');

  // The tier is the sidebar's top level and comes from the section's own
  // `type`; its heading resolves from `SCREEN_TYPE_LABEL_KEYS`, so a section
  // contributed with `type: 'operation'` is the whole of what makes this
  // appear (ADR 0033).
  const operations = page.getByRole('group', { name: 'Operaciones' });

  await expect(operations).toBeVisible();
  // `exact` on all three: every nav item renders the destination link plus an
  // "open in workspace" and an "open in a new tab" affordance whose accessible
  // names *contain* the item's, so a loose match resolves to three elements.
  await expect(
    operations.getByRole('link', {
      name: 'Existencias en almacén',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    operations.getByRole('link', { name: 'Libro de movimientos', exact: true }),
  ).toBeVisible();
  await expect(
    operations.getByRole('link', { name: 'Reservas', exact: true }),
  ).toBeVisible();

  // And they are not in the Definiciones group, which is the actual claim: a
  // record a process made is not a thing you define.
  await expect(
    page
      .getByRole('group', { name: 'Definiciones' })
      .getByRole('link', { name: 'Existencias en almacén', exact: true }),
  ).toHaveCount(0);
});

test('lists the seeded positions with the totals the ledger implies', async ({
  page,
}) => {
  await page.goto('/stock/stock-item');

  const row = page.getByRole('row').filter({ hasText: 'product-offering-1' });

  await expect(row).toBeVisible();
  await expect(row).toContainText('10');
  // The columns are derived from the entity's own accessor metadata, so their
  // presence is what says the descriptor reached the table.
  await expect(page.getByRole('columnheader', { name: 'En almacén' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Reservado' })).toBeVisible();
});

test('offers no way to edit a quantity, because the service says so', async ({
  page,
}) => {
  await page.goto('/stock/stock-item/stock-item-1');

  // The values are shown — a stock screen that hid the quantities would have
  // nothing left to show. They are *values*, though, not inputs.
  await expect(page.getByText('product-offering-1')).toBeVisible();
  await expect(page.getByText('10', { exact: true }).first()).toBeVisible();

  // ⚠️ **The assertion this surface exists to hold.** `onHand` and `reserved`
  // are `type: 'number'` accessors, which is exactly what the generator turns
  // into editable fields with a Save that `PUT`s an absolute quantity — the
  // read-modify-write ADR 0010 forbids. What prevents it is the served
  // descriptor answering `["read"]`: no role holds `stock-item:write` and
  // stock-service has no save route.
  //
  // Asserted on **roles rather than labels**: the read display still labels
  // each value, so `getByLabel` matches either way and would pass against the
  // editable form this test exists to rule out. A `spinbutton` is a number
  // input and nothing else.
  await expect(page.getByRole('spinbutton')).toHaveCount(0);
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Guardar' })).toHaveCount(0);
  // And no way back into them: passing a mode suppresses the built-in
  // Ver/Editar toggle, so a refused write cannot be reached around.
  await expect(page.getByRole('button', { name: 'Editar' })).toHaveCount(0);
});

test('records a movement, which is the only write in the domain', async ({
  page,
}) => {
  await page.goto('/stock/stock-movement/new');

  // A signed quantity and a reason, both real inputs: `stock-movement` is the
  // one entity here whose descriptor answers `["read","write"]`.
  await expect(page.getByLabel('ID de oferta')).toBeVisible();
  await expect(page.getByLabel('Cantidad')).toBeVisible();
  await expect(page.getByLabel('Motivo')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guardar' })).toBeVisible();

  // `id` is server-owned — `record-movement.ts` mints it — so it is hidden
  // rather than offered as a field the service would overwrite.
  await expect(page.getByLabel('ID', { exact: true })).toHaveCount(0);
});

test('addresses a stock tab as an operation, not a master', async ({ page }) => {
  await page.goto('/workspace?tab=operation%3Astock-item');

  // The address is the taxonomy serialized (ADR 0042), so this is the assertion
  // that the registry gained a second entity kind rather than filing an
  // Operaciones screen under `master:`.
  await expect(
    page.getByRole('columnheader', { name: 'En almacén' }),
  ).toBeVisible();

  // A record tab under the same kind, which is where the draft address has to
  // agree with the tab address or the autosave detaches silently.
  await page.goto('/workspace?tab=operation%3Astock-item%3Astock-item-1');
  await expect(page.getByText('product-offering-1').first()).toBeVisible();
});

test('opens the stock list from the sidebar in the workspace', async ({
  page,
}) => {
  await page.goto('/stock/stock-item');

  await page
    .getByRole('link', {
      name: 'Abrir Existencias en almacén en el espacio de trabajo',
    })
    .click();

  // The nav's workspace address and the registry's parser are derived from the
  // same surface, so this is the round trip that used to fail silently when the
  // two were written out by hand.
  await expect(page).toHaveURL(/tab=operation%3Astock-item/);
});
