import type { Page } from '@playwright/test';
import { http, HttpResponse } from 'msw';

import {
  expect,
  FLOW_STATUS_URL,
  scriptStream,
  test,
} from './support/stream-fixture';

/**
 * Checkout, as the storefront speaks the composed checkout's contract
 * (ADR 0069, ADR 0073): the coordinator answers `202` with a flow, the buyer
 * waits on its order-status page, the stream says how it ended, and only then
 * does the server write the group receipt and empty the cart.
 *
 * ⚠️ The coordinator, flow-status and order-service are stubbed **inside the
 * Next process** (`support/server-mocks.mjs`): the checkout and the settle are
 * server actions, so a `page.route()` interceptor would never see them. What
 * the browser fixture stubs is the browser's own: the stream and the catch-up.
 */

const STATUS_PAGE = /\/es\/order\/status\/e2e-flow-/;

const addToCart = async (page: Page, offeringId: string) => {
  await page.goto(`/es/p/${offeringId}`);
  await page
    .getByRole('form', { name: 'Comprar' })
    .getByRole('button', { name: 'Añadir al carrito' })
    .click();
  await page.waitForURL(/\/es\/cart(\?|$)/);
};

const startCheckout = async (page: Page) => {
  await page.getByTestId('checkout').click();
  await page.waitForURL(STATUS_PAGE);
};

/**
 * A seller's cancel, through its confirmation: the trigger opens an alert
 * dialog naming the order and the refund, and only its confirm acts (a3-2).
 */
const cancelOrder = async (page: Page, vendorId: string) => {
  await page
    .getByTestId(`cancel-${vendorId}`)
    .getByRole('button', { name: 'Cancelar pedido' })
    .click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('reembolsaremos');
  await dialog
    .getByRole('button', { name: 'Cancelar pedido y reembolsar' })
    .click();
};

test.describe('a checkout', () => {
  test('waits on its flow, then lands on a receipt that names each seller', async ({
    page,
    network,
  }) => {
    const script = scriptStream(network);
    await addToCart(page, 'offering-aurora-desk-lamp');
    await startCheckout(page);

    // A live region, so waiting is announced as well as shown (a4-29).
    await expect(page.getByTestId('order-pending')).toHaveRole('status');

    script.outcome = 'flow.completed';

    await expect(page.getByTestId('order-id')).toContainText(
      'e2e-flow-placed-',
    );
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      '¡Gracias por tu compra!',
    );
    const order = page.getByTestId('vendor-order-demo-organization');
    await expect(order).toContainText('Demo Vendor');
    await expect(order.getByText('Aurora Desk Lamp')).toBeVisible();
    await expect(order.getByTestId('vendor-order-method')).toHaveText(
      'Tarjeta',
    );
    await expect(page.getByTestId('order-total')).toBeVisible();
  });

  test('keeps its receipt across a reload, with the cart empty behind it', async ({
    page,
    network,
  }) => {
    const script = scriptStream(network);
    await addToCart(page, 'offering-aurora-desk-lamp');
    await startCheckout(page);
    script.outcome = 'flow.completed';
    await expect(page.getByTestId('order-id')).toBeVisible();

    await page.reload();
    await expect(page.getByTestId('order-id')).toContainText(
      'e2e-flow-placed-',
    );

    // ⚠️ The cart was cleared on the path it was written with. Expiring it on
    // another path leaves the original cookie in place, and the basket comes
    // back on the next request.
    await page.goto('/es/cart');
    await expect(page.getByText('Tu carrito está vacío')).toBeVisible();
  });

  test('that fails says nothing was charged, and keeps the cart', async ({
    page,
    network,
  }) => {
    const script = scriptStream(network);
    await addToCart(page, 'offering-aurora-floor-lamp');
    await startCheckout(page);
    await expect(page.getByTestId('order-pending')).toBeVisible();

    script.outcome = 'flow.failed';

    await expect(page.getByTestId('order-failed')).toHaveRole('alert');
    await expect(page.getByTestId('order-retry')).toBeVisible();
    await expect(page.getByTestId('order-id')).toHaveCount(0);

    await page.goto('/es/cart');
    await expect(page.getByTestId('cart-line-price')).toBeVisible();
  });

  /**
   * The outcome never arrives as a push: the tab that heard nothing was
   * reloaded. What the new page has is its ticket cookie and flow-status.
   */
  test('reloaded while pending catches up from flow-status', async ({
    page,
    network,
  }) => {
    scriptStream(network, { retryMs: 60_000 });
    await addToCart(page, 'offering-aurora-desk-lamp');
    await startCheckout(page);
    await expect(page.getByTestId('order-pending')).toBeVisible();

    network.use(
      http.get(FLOW_STATUS_URL, ({ params }) =>
        HttpResponse.json({
          meta: { type: 'flowStatus', entity: 'flow' },
          data: { flowId: params['id'], state: 'completed' },
        }),
      ),
    );
    await page.reload();

    await expect(page.getByTestId('order-id')).toContainText(
      'e2e-flow-placed-',
    );
  });

  test('offers cash on delivery only where the seller ships it, and keeps the choice per seller', async ({
    page,
    network,
  }) => {
    const script = scriptStream(network);
    await addToCart(page, 'offering-aurora-desk-lamp');
    await addToCart(page, 'offering-solano-clip-light');

    const solano = page.getByTestId('tender-vendor-casa-solano');
    const demo = page.getByTestId('tender-demo-organization');
    // Named by what it chooses, inside a group the seller names (a3-26).
    await expect(solano).toHaveAccessibleName('Forma de pago');
    await expect(
      page.getByRole('group', { name: 'Casa Solano' }).getByRole('combobox', {
        name: 'Forma de pago',
      }),
    ).toBeVisible();
    await expect(solano.locator('option[value="cod"]')).toHaveCount(1);
    await expect(demo.locator('option[value="cod"]')).toHaveCount(0);
    await solano.selectOption('cod');

    await startCheckout(page);
    script.outcome = 'flow.completed';

    await expect(
      page
        .getByTestId('vendor-order-vendor-casa-solano')
        .getByTestId('vendor-order-method'),
    ).toHaveText('Contra entrega');
    await expect(
      page
        .getByTestId('vendor-order-demo-organization')
        .getByTestId('vendor-order-method'),
    ).toHaveText('Tarjeta');
  });
});

test.describe('the receipt', () => {
  /**
   * ⚠️ **The affordance and the window are one decision, and this is the half a
   * unit test cannot show.** The receipt carries the nonce and the moment the
   * server stamped; the page offers the button only while both hold
   * (ADR 0058 §5). A cancel is per vendor order (ADR 0069): the other seller's
   * order is untouched.
   */
  test('lets the buyer cancel one seller’s order and leaves the other', async ({
    page,
    network,
  }) => {
    const script = scriptStream(network);
    await addToCart(page, 'offering-aurora-desk-lamp');
    await addToCart(page, 'offering-solano-clip-light');
    await startCheckout(page);
    script.outcome = 'flow.completed';

    await expect(page.getByTestId('cancel-window')).toBeVisible();
    await cancelOrder(page, 'vendor-casa-solano');
    await page.waitForURL(/cancel=cancelled/);

    await expect(
      page
        .getByTestId('vendor-order-vendor-casa-solano')
        .getByTestId('vendor-order-cancelled'),
    ).toBeVisible();
    await expect(page.getByTestId('cancel-vendor-casa-solano')).toHaveCount(0);
    await expect(page.getByTestId('cancel-demo-organization')).toBeVisible();
    await expect(page.getByTestId('order-id')).toContainText(
      'e2e-flow-placed-',
    );
    // One order of two is still standing, so the receipt still thanks.
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      '¡Gracias por tu compra!',
    );
  });

  test('says the purchase was cancelled once every order on it is', async ({
    page,
    network,
  }) => {
    const script = scriptStream(network);
    await addToCart(page, 'offering-aurora-desk-lamp');
    await startCheckout(page);
    script.outcome = 'flow.completed';
    await expect(page.getByTestId('cancel-window')).toBeVisible();

    // Dismissing the dialog acts on nothing.
    await page
      .getByTestId('cancel-demo-organization')
      .getByRole('button', { name: 'Cancelar pedido' })
      .click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Conservar el pedido' })
      .click();
    await expect(page).not.toHaveURL(/cancel=/);
    await expect(page.getByTestId('vendor-order-cancelled')).toHaveCount(0);

    await cancelOrder(page, 'demo-organization');
    await page.waitForURL(/cancel=cancelled/);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Pedido cancelado',
    );
    await expect(page.getByText('¡Gracias por tu compra!')).toHaveCount(0);
    await expect(page.getByTestId('cancel-done')).toHaveRole('status');
  });

  /**
   * The confirmation is the action's, not the dialog's (entifix ADR 0026): a
   * post that skipped the dialog — a stale page, a script, a first click with
   * scripting off — acts on nothing, because `whenConfirmed` is what the post
   * reaches. Only the dialog's confirming post starts the cancellation.
   *
   * ⚠️ The post is made natively (`form.submit()` bypasses the dialog's
   * handler) rather than from a context with scripting off: the receipt is a
   * dynamic page that streams behind a Suspense boundary, and with scripting
   * off its streamed content is never swapped in, so that context sees an
   * empty `main` whatever the action does.
   */
  test('a cancel that skipped the dialog acts on nothing', async ({
    page,
    network,
  }) => {
    const script = scriptStream(network);
    await addToCart(page, 'offering-aurora-desk-lamp');
    await startCheckout(page);
    script.outcome = 'flow.completed';
    await expect(page.getByTestId('cancel-window')).toBeVisible();
    const receipt = page.url();

    await page
      .getByTestId('cancel-demo-organization')
      .locator('form')
      .first()
      .evaluate(form => (form as HTMLFormElement).submit());
    await page.waitForLoadState();

    await expect(page.getByTestId('order-id')).toBeVisible();
    expect(page.url()).toBe(receipt);
    await expect(page.getByText('Cancelando este pedido…')).toHaveCount(0);
    await expect(page.getByTestId('vendor-order-cancelled')).toHaveCount(0);

    await cancelOrder(page, 'demo-organization');
    await page.waitForURL(/cancel=cancelled/);
    await expect(page.getByTestId('vendor-order-cancelled')).toBeVisible();
  });

  /**
   * #387: a cancel clicked before the order turned `paid` is "not yet", not
   * "never". The buyer is told to retry, and the button stays, because the
   * nonce was never spent.
   */
  test('asks the buyer to retry a cancel that beats the payment confirmation', async ({
    page,
    network,
  }) => {
    const script = scriptStream(network);
    await addToCart(page, 'offering-terra-ceramic-mug');
    await startCheckout(page);
    script.outcome = 'flow.completed';

    await cancelOrder(page, 'demo-organization');
    await page.waitForURL(/cancel=pending/);

    await expect(page.getByTestId('cancel-payment-pending')).toContainText(
      'todavía se está confirmando',
    );
    await expect(page.getByTestId('cancel-failed')).toHaveCount(0);
    await expect(page.getByTestId('cancel-demo-organization')).toBeVisible();
  });

  test('is not shown for a flow this browser never started', async ({
    page,
  }) => {
    await page.goto('/es/order/status/someone-elses-flow');

    await expect(page.getByTestId('receipt-expired')).toBeVisible();
    await expect(page.getByTestId('order-pending')).toHaveCount(0);
  });
});
