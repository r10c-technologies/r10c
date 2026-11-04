import {
  CANCEL_FLOW_ID,
  cancels,
  expect,
  PAID_ORDER_ID,
  test,
} from './support/fixtures';
import { scriptStream } from './support/flow-stream';

/**
 * A vendor cancelling a paid order from the back office (ADR 0058, #487):
 * the `cancel` verb answers `202` with the cancellation to follow, the verb
 * waits on it, and the push stream settles it. What runs for real is the
 * generated record screen, its verb affordance from `$metadata`, and the
 * optimistic path every verb shares.
 */
test('cancels a paid order and waits on its cancellation to complete', async ({
  page,
  network,
}) => {
  const cancellation = scriptStream(network, CANCEL_FLOW_ID);
  await page.goto(`/order/product-order/${PAID_ORDER_ID}`);

  await page.getByRole('button', { name: 'Cancelar pedido' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Confirmar' })
    .click();

  await expect.poll(() => cancels.includes(PAID_ORDER_ID)).toBe(true);
  // Accepted is not done: the verb stays busy while its cancellation runs.
  const cancel = page.getByRole('button', { name: 'Cancelar pedido' });
  await expect(cancel).toBeDisabled();

  cancellation.outcome = 'flow.completed';
  // Settled by push, the record reloads and the verb is free again.
  await expect(cancel).toBeEnabled();
});
