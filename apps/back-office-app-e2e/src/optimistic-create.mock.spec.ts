import { expect, test, untrackTransactions } from './support/fixtures';

/**
 * Creating a record that the server has not finished writing.
 *
 * A specification is created through the saga: the `POST` carries a command
 * envelope and the service answers `202` describing a *transaction*, not an
 * entity ([ADR 0028](../../../docs/adr/0028-the-transaction-id-is-the-clients-and-its-event-ships-with-the-write.md)).
 * Before [ADR 0043](../../../docs/adr/0043-the-optimistic-mutation-contract.md)
 * nothing downstream of the save adapter knew that, so the form navigated to a
 * list that did not contain the record yet and a later failure said nothing at
 * all.
 *
 * This is the first browser-side create journey in the suite, and the reason
 * there was none is worth recording: the shared mock backend
 * (`entity-backend.ts`) is **read-only** — `list` and `get`, no write — so the
 * command endpoint had to be hand-stubbed in this app's fixtures.
 *
 * ⚠️ **The stream is deliberately not stubbed.** `EventSource` against an
 * unstubbed path never opens, which is exactly the state the design has to
 * survive: the write is in flight, no outcome can arrive, and what the operator
 * must see is the record and an honest "still saving" rather than an empty list.
 * The settle-on-event and reconcile-on-reconnect paths are unit-tested, where
 * the transport can be driven; what only a browser can prove is this chain —
 * adapter announces, store records, list renders.
 */

const NEW_PRODUCT = '/catalog/product/new';
const PRODUCT_LIST = '/catalog/product';

test.beforeEach(() => {
  // The broker-down state: the tracker has never heard of the transaction. A
  // `404` here means *not tracked yet*, never *failed*, so the write must stay
  // pending rather than being rolled back.
  untrackTransactions();
});

test('renders a record the server has not finished writing, and says so', async ({
  page,
}) => {
  await page.goto(NEW_PRODUCT);

  // `name` is `required` on the entity, so the form will not submit without it.
  // `code` is not asked for at all — the create transaction assigns it.
  await page.getByLabel(/nombre/i).fill('Optimistic Widget');
  await page.getByRole('button', { name: 'Guardar' }).click();

  // The form leaves for the list — optimistically, before the write commits.
  await page.waitForURL(url => url.pathname.endsWith(PRODUCT_LIST));

  // The record is on screen although the service has stored nothing yet. This
  // is the whole point: the `202` is not a result, and a list that omitted the
  // row would read as a write that vanished.
  await expect(
    page.getByRole('cell', { name: 'Optimistic Widget' }).first(),
  ).toBeVisible();

  // And the operator is told it is not finished, rather than being left to
  // assume a row on screen means a row in the database.
  await expect(page.getByTestId('pending-notice')).toContainText(/guardando/i);
});

test('keeps the write pending while the tracker has no record of it', async ({
  page,
}) => {
  await page.goto(NEW_PRODUCT);
  await page.getByLabel(/nombre/i).fill('Broker Is Down');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await page.waitForURL(url => url.pathname.endsWith(PRODUCT_LIST));

  await expect(page.getByTestId('pending-notice')).toContainText(/guardando/i);

  // ⚠️ Never rolled back. With the broker down the entity write commits while
  // no `accepted` event ever reaches the tracker, so a `404` describes a write
  // in perfect health — un-rendering it here would be the bug.
  await expect(page.getByTestId('pending-notice')).not.toContainText(
    /no se pudo/i,
  );
  await expect(
    page.getByRole('cell', { name: 'Broker Is Down' }).first(),
  ).toBeVisible();
});
