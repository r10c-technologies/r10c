import {
  AWAITING_SHIPMENT_2_ID,
  AWAITING_SHIPMENT_ID,
  DELIVERY_FLOW_ID,
  DISPATCHED_SHIPMENT_ID,
  dispatches,
  expect,
  moveShipment,
  record,
  REFUSED_SHIPMENT_ID,
  shipmentSeed,
  shippingOrderBackend,
  test,
} from './support/fixtures';
import { scriptStream } from './support/flow-stream';

/**
 * A vendor's dispatch worklist (#489, ADR 0070): the screen opens on what is
 * waiting to be handed to a courier, `dispatch` answers `202` and waits on the
 * delivery flow the push stream settles once the flow parks on its courier
 * (`flow.waiting`, past the dispatch pivot), and the courier's report is a
 * plain move made while that flow still waits. What runs for real is the generated list with its preset filter, the
 * record screen, its verbs from `$metadata` and the shared optimistic path.
 */
test.beforeEach(() => {
  shippingOrderBackend.seed(shipmentSeed());
});

test('opens on the shipments awaiting dispatch', async ({ page }) => {
  await page.goto('/fulfilment/shipping-order');

  await expect(record(page, /order-awaiting-1/).first()).toBeVisible();
  // A dispatched parcel is one filter change away, not on the worklist.
  await expect(page.getByText('order-dispatched-1')).toHaveCount(0);
});

test('reaches the worklist from the navigation', async ({ page }) => {
  await page.goto('/account');

  await page
    .getByRole('navigation')
    .getByRole('link', { name: 'Envíos' })
    .first()
    .click();

  await expect(page).toHaveURL(/\/fulfilment\/shipping-order$/);
});

test('dispatches a shipment, waits on its delivery flow, then records the delivery', async ({
  page,
  network,
}) => {
  const delivery = scriptStream(network, DELIVERY_FLOW_ID);
  await page.goto(`/fulfilment/shipping-order/${AWAITING_SHIPMENT_ID}`);

  const dispatch = page.getByRole('button', { name: 'Despachar' });
  await dispatch.click();
  // The parcel leaves for good, so the verb asks first, naming what follows.
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('ya no puede cancelarse');
  await confirm.getByRole('button', { name: 'Despachar' }).click();

  await expect.poll(() => dispatches.includes(AWAITING_SHIPMENT_ID)).toBe(true);
  // Accepted is not done: the verb stays busy while the delivery flow runs.
  await expect(dispatch).toBeDisabled();

  // The flow's pivot moved the shipment, and the flow parks on the courier's
  // report — days, in the real fleet. It never completes here: what settles the
  // dispatch is the flow saying it waits past its commit point.
  moveShipment(AWAITING_SHIPMENT_ID, 'dispatched');
  delivery.outcome = 'flow.waiting';
  await expect(page.getByText('Despachado').first()).toBeVisible();
  // A dispatched parcel cannot be dispatched again, so the verb leaves the
  // header — and the focus it held goes to the form, not `<body>`.
  await expect(dispatch).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.tagName))
    .not.toBe('BODY');

  await page.getByRole('button', { name: 'Registrar entrega' }).click();
  await expect(page.getByText('Entregado').first()).toBeVisible();
});

test('offers each shipment only the moves its status allows', async ({
  page,
}) => {
  const verbs = page.getByRole('button', {
    name: /^(Despachar|Registrar entrega|Registrar rechazo|Registrar devolución)$/,
  });

  await page.goto(`/fulfilment/shipping-order/${AWAITING_SHIPMENT_ID}`);
  await expect(page.getByRole('button', { name: 'Despachar' })).toBeVisible();
  await expect(verbs).toHaveCount(1);

  await page.goto(`/fulfilment/shipping-order/${DISPATCHED_SHIPMENT_ID}`);
  await expect(
    page.getByRole('button', { name: 'Registrar entrega' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Registrar rechazo' }),
  ).toBeVisible();
  await expect(verbs).toHaveCount(2);

  await page.goto(`/fulfilment/shipping-order/${REFUSED_SHIPMENT_ID}`);
  await expect(
    page.getByRole('button', { name: 'Registrar devolución' }),
  ).toBeVisible();
  await expect(verbs).toHaveCount(1);
});

test('asks before recording a refusal, and records nothing when cancelled', async ({
  page,
}) => {
  await page.goto(`/fulfilment/shipping-order/${DISPATCHED_SHIPMENT_ID}`);

  await page.getByRole('button', { name: 'Registrar rechazo' }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('se cierra sin venta');
  await confirm.getByRole('button', { name: 'Cancelar' }).click();

  await expect(confirm).toHaveCount(0);
  await expect(page.getByText('Despachado').first()).toBeVisible();
});

test('refuses a dispatch the shipment moved past while the page was open, and names the legal move', async ({
  page,
}) => {
  await page.goto(`/fulfilment/shipping-order/${AWAITING_SHIPMENT_ID}`);
  await expect(page.getByRole('button', { name: 'Despachar' })).toBeVisible();
  // A cancellation held it after the page rendered: the button is stale, and
  // the service is the authority.
  moveShipment(AWAITING_SHIPMENT_ID, 'held');

  await page.getByRole('button', { name: 'Despachar' }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Despachar' })
    .click();

  // The refusal says what can happen from here, not only what cannot (#532).
  await expect(
    page.getByText(/no admite ese movimiento.*«Despachar»/),
  ).toBeVisible();
});

test('dispatches a selection from the worklist, and names the shipment that could not go', async ({
  page,
}) => {
  await page.goto('/fulfilment/shipping-order');
  // One of the two was held by a cancellation after the list loaded.
  await expect(record(page, /order-awaiting-2/).first()).toBeVisible();
  moveShipment(AWAITING_SHIPMENT_2_ID, 'held');

  await record(page, /order-awaiting-1/)
    .getByRole('checkbox')
    .check();
  await record(page, /order-awaiting-2/)
    .getByRole('checkbox')
    .check();
  await page
    .getByTestId('bulk-action-bar')
    .getByRole('button', { name: 'Despachar' })
    .click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Despachar 2' })
    .click();

  await expect.poll(() => dispatches.includes(AWAITING_SHIPMENT_ID)).toBe(true);
  expect(dispatches).not.toContain(AWAITING_SHIPMENT_2_ID);
  // The failed row is named by the first column the table shows it by.
  await expect(page.getByTestId('bulk-result')).toContainText(
    'order-awaiting-2',
  );
});
