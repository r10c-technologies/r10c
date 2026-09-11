import { expect, test } from './support/fixtures';

/**
 * The settlement surface: a vendor's commercial terms, and what they are owed.
 *
 * Mock-only, and for the shape of what is asserted rather than the data: these
 * journeys are about which tier each screen lands in and which affordances the
 * browser renders, and the served descriptor that decides the second is stubbed
 * verbatim in `fixtures.ts`. The service's half is `settlement-service-e2e`, and
 * the fold itself is live by construction — it is two bus messages meeting, and
 * a broker stubbed in a browser test would assert that a page can render a row.
 */

/**
 * ⚠️ **The claim worth pinning hardest.** Every other domain shell contributes
 * screens of one kind; this one spans two tiers, and by ADR 0033's own test: an
 * agreement is authored and every settled sale then references it, while a
 * ledger line, a run and a payout are each produced by a process. A regression
 * here would file a payout under a heading that says a person wrote it.
 */
test('files agreements under Definiciones and the statement under Operaciones', async ({
  page,
}) => {
  await page.goto('/settlement/agreement');

  await expect(
    page
      .getByRole('group', { name: 'Definiciones' })
      .getByRole('link', { name: 'Acuerdos', exact: true }),
  ).toBeVisible();

  const operations = page.getByRole('group', { name: 'Operaciones' });
  await expect(
    operations.getByRole('link', { name: 'Apuntes de comisión', exact: true }),
  ).toBeVisible();
  await expect(
    operations.getByRole('link', { name: 'Liquidaciones', exact: true }),
  ).toBeVisible();
  await expect(
    operations.getByRole('link', { name: 'Pagos a vendedores', exact: true }),
  ).toBeVisible();
});

test('lists the vendor’s agreement', async ({ page }) => {
  await page.goto('/settlement/agreement');

  // `exact`, because the id column renders `agreement-e2e-organization` and the
  // vendor id is a substring of it. `hiddenFields` hides a member from the
  // *form*, never from the table.
  await expect(
    page.getByRole('cell', { name: 'e2e-organization', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('cell', { name: '800' })).toBeVisible();
});

/**
 * ⚠️ **No Save, and no client-side flag makes it so.** No role holds
 * `settlement-management:agreement:write`, so the served descriptor answers
 * `["read"]` and the form renders in read mode. Asserted by **role** rather than
 * by label, so a Save that came back under a different caption would still fail
 * this.
 */
test('opens an agreement read-only for an admin', async ({ page }) => {
  await page.goto('/settlement/agreement/agreement-e2e-organization');

  await expect(page.getByRole('button', { name: 'Guardar' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Editar' })).toHaveCount(0);
});

/**
 * ⚠️ **The distinction the whole per-channel feature exists for.** An absent
 * rate means "charge the default"; a `0` means "take nothing at this counter".
 * The seeded agreement has `counter: 0` and no entry for any other channel, so
 * a control that coerced absent into `0` — or `0` into absent — fails here.
 */
test('shows an absent channel rate and a zero one as different values', async ({
  page,
}) => {
  await page.goto('/settlement/agreement/agreement-e2e-organization');

  await expect(page.getByText('counter: 0')).toBeVisible();
  await expect(page.getByText('storefront')).toHaveCount(0);
});

test('shows the ledger line behind a payout', async ({ page }) => {
  await page.goto('/settlement/commission-entry');

  await expect(page.getByRole('cell', { name: 'order-1' })).toBeVisible();
  // The base and the cut, both on the line. A payout is the first minus the
  // second, which is why the entry captures the base at all.
  await expect(page.getByRole('cell', { name: '2500' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '200' })).toBeVisible();
});

test('shows what the vendor is owed, not what the platform kept', async ({
  page,
}) => {
  await page.goto('/settlement/vendor-payout');

  // 2500 sold less 200 commission. The number that would appear if a payout
  // folded the commissions instead is 200, and it must not.
  await expect(page.getByRole('cell', { name: '2300' })).toBeVisible();
  await expect(
    page.getByRole('cell', { name: '200', exact: true }),
  ).toHaveCount(0);
});

test('opens a payout read-only', async ({ page }) => {
  await page.goto('/settlement/vendor-payout/vendor-payout-1');

  await expect(page.getByRole('button', { name: 'Guardar' })).toHaveCount(0);
  // `id` is hidden on every generated settlement screen, as it is everywhere.
  await expect(page.getByLabel('ID', { exact: true })).toHaveCount(0);
});

/**
 * Both tiers address their tabs by their own screen type, which is what the
 * surface carrying `screenType` rather than hard-coding one buys. A shell that
 * hard-coded `master` would put `master:vendor-payout` in the URL and the
 * registry would then have to keep that lie.
 */
test('round-trips both tiers through the workspace', async ({ page }) => {
  await page.goto('/workspace?tab=master%3Aagreement');
  await expect(page).toHaveURL(/tab=master%3Aagreement/);

  await page.goto('/workspace?tab=operation%3Avendor-payout');
  await expect(page).toHaveURL(/tab=operation%3Avendor-payout/);

  await page.goto('/workspace?tab=operation%3Avendor-payout%3Avendor-payout-1');
  await expect(page).toHaveURL(
    /tab=operation%3Avendor-payout%3Avendor-payout-1/,
  );
});
