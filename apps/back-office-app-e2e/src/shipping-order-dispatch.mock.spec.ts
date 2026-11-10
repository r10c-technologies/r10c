import {
  AWAITING_SHIPMENT_ID,
  DELIVERY_FLOW_ID,
  dispatches,
  expect,
  moveShipment,
  record,
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

  await expect.poll(() => dispatches.includes(AWAITING_SHIPMENT_ID)).toBe(true);
  // Accepted is not done: the verb stays busy while the delivery flow runs.
  await expect(dispatch).toBeDisabled();

  // The flow's pivot moved the shipment, and the flow parks on the courier's
  // report — days, in the real fleet. It never completes here: what settles the
  // dispatch is the flow saying it waits past its commit point.
  moveShipment(AWAITING_SHIPMENT_ID, 'dispatched');
  delivery.outcome = 'flow.waiting';
  await expect(dispatch).toBeEnabled();
  await expect(page.getByText('Despachado').first()).toBeVisible();

  await page.getByRole('button', { name: 'Registrar entrega' }).click();
  await expect(page.getByText('Entregado').first()).toBeVisible();
});

test('refuses recording delivery on a shipment not yet dispatched, and names the legal move', async ({
  page,
}) => {
  await page.goto(`/fulfilment/shipping-order/${AWAITING_SHIPMENT_ID}`);

  await page.getByRole('button', { name: 'Registrar entrega' }).click();

  // The refusal says what can happen from here, not only what cannot (#532).
  await expect(
    page.getByText(/no admite ese movimiento.*«Despachar»/),
  ).toBeVisible();
});
