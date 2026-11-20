import type { Page } from '@playwright/test';
import { http, HttpResponse } from 'msw';

import { fillDelivery } from './support/delivery';
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

/** How the receipt names a purchase: its readable number (ADR 0076 §5). */
const ORDER_NUMBER = /Número de pedido: [0-9A-Z]{4}-[0-9A-Z]{4}$/;

/** A UUID, which the receipt must never show a buyer. */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** The review step, reached with nothing on the query (ADR 0076 §7). */
const REVIEW_PAGE = /\/es\/cart\/review\??$/;

const addToCart = async (page: Page, offeringId: string) => {
  await page.goto(`/es/p/${offeringId}`);
  await page
    .getByRole('form', { name: 'Comprar' })
    .getByRole('button', { name: 'Añadir al carrito' })
    .click();
  await page.waitForURL(/\/es\/cart(\?|$)/);
};

/**
 * From the cart through the review step (#534): Review order lands on a page
 * that shows each seller's lines, tender and the total, and only Place order
 * there starts the flow.
 */
const startCheckout = async (page: Page) => {
  await page.getByTestId('review').filter({ visible: true }).click();
  await page.waitForURL(/\/es\/cart\/review/);
  await fillDelivery(page);
  // A review page an earlier navigation left hidden can still be in the DOM.
  await page.getByTestId('checkout').filter({ visible: true }).click();
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

    await expect(page.getByTestId('order-id')).toHaveText(ORDER_NUMBER);
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
    // The IVA the price includes, and whom the receipt is billed to.
    await expect(order.getByTestId('vendor-order-iva')).toContainText(
      'IVA incluido:',
    );
    await expect(page.getByTestId('order-billed-to')).toHaveText(
      'Facturado a: Consumidor final',
    );

    // #670: where the order stands — paid, on its way next — and never a
    // payment step that reads as done before it is.
    await expect(order.getByTestId('tracker-payment')).toHaveAttribute(
      'data-state',
      'done',
    );
    await expect(order.getByTestId('tracker-dispatched')).toHaveAttribute(
      'aria-current',
      'step',
    );
    // #671: a chat with the seller, prefilled with the order.
    await expect(order.getByTestId('vendor-order-whatsapp')).toHaveAttribute(
      'href',
      /^https:\/\/wa\.me\/50255550100\?text=/,
    );

    // #585: a number to quote and the seller's own, where the parcel goes
    // with the phone masked, until when it can be read — and no UUID.
    await expect(order.getByTestId('vendor-order-number')).toHaveText(
      /^Pedido [0-9A-Z]{4}-[0-9A-Z]{4}$/,
    );
    const delivery = page.getByTestId('order-delivery');
    await expect(delivery).toContainText('Ana López');
    await expect(page.getByTestId('order-delivery-phone')).toHaveText(
      'Teléfono: •••• 1234',
    );
    await expect(page.getByTestId('order-delivery-place')).toHaveText(
      'Mixco, Guatemala',
    );
    await expect(delivery).not.toContainText('ana@correo.com');
    await expect(page.getByTestId('receipt-until')).toContainText('2099');
    expect(await page.locator('main:visible').innerText()).not.toMatch(UUID);
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
    await expect(page.getByTestId('order-id')).toHaveText(ORDER_NUMBER);

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

    await expect(page.getByTestId('order-id')).toHaveText(ORDER_NUMBER);
  });

  test('asks each seller who ships how to pay them, and the receipt names each choice', async ({
    page,
    network,
  }) => {
    const script = scriptStream(network);
    await addToCart(page, 'offering-aurora-desk-lamp');
    await addToCart(page, 'offering-solano-clip-light');
    await page.getByTestId('review').filter({ visible: true }).click();
    await page.waitForURL(REVIEW_PAGE);

    // Two tenders: a group the seller names, with nothing chosen for them.
    const solano = page.getByRole('group', {
      name: 'Cómo le pagas a Casa Solano',
    });
    await expect(solano.getByRole('radio')).toHaveCount(2);
    for (const radio of await solano.getByRole('radio').all()) {
      await expect(radio).not.toBeChecked();
    }
    await expect(
      solano.getByRole('radio', { name: 'Tarjeta' }),
    ).toHaveAccessibleDescription(/no te pedimos datos de tarjeta/);
    await expect(
      page.getByTestId('payment-demo-organization').getByRole('radio'),
    ).toHaveCount(2);

    await fillDelivery(page, { 'vendor-casa-solano': 'cod' });
    await page.getByTestId('checkout').filter({ visible: true }).click();
    await page.waitForURL(STATUS_PAGE);
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

test.describe('the review step', () => {
  test('shows each seller and the total, and starts nothing until placed', async ({
    page,
  }) => {
    await addToCart(page, 'offering-aurora-desk-lamp');
    await addToCart(page, 'offering-solano-clip-light');

    // Nothing about tenders travels from the cart (ADR 0076 §7).
    await page.getByTestId('review').filter({ visible: true }).click();
    await page.waitForURL(REVIEW_PAGE);

    await expect(
      page.getByRole('heading', { level: 1, name: 'Revisa tu pedido' }),
    ).toBeVisible();
    await expect(
      page.getByTestId('review-seller-vendor-casa-solano'),
    ).toBeVisible();
    await expect(page.getByTestId('review-total')).toBeVisible();
    // Reviewing is not ordering: no flow has a status page yet.
    await expect(page).not.toHaveURL(STATUS_PAGE);
  });

  test('refuses a seller who takes two tenders until the buyer chooses one, keeping what was typed', async ({
    page,
  }) => {
    await addToCart(page, 'offering-solano-clip-light');
    await page.getByTestId('review').filter({ visible: true }).click();
    await page.waitForURL(REVIEW_PAGE);

    // The contact, but no tender: the form names the missing choice in place.
    const form = page.getByTestId('delivery-form').filter({ visible: true });
    await form
      .getByLabel('Nombre de quien recibe', { exact: true })
      .fill('Ana López');
    await form.getByLabel('Teléfono', { exact: true }).fill('5555-1234');
    await form
      .getByLabel('Correo electrónico', { exact: true })
      .fill('ana@correo.com');
    await form.getByLabel('Municipio', { exact: true }).selectOption('0108');
    await form
      .getByLabel('Dirección', { exact: true })
      .fill('5a avenida 12-34');
    await page.getByTestId('checkout').filter({ visible: true }).click();

    // Only the tender is refused: every contact field passed.
    await expect(form.locator('[data-testid^="delivery-error-"]')).toHaveCount(
      0,
    );
    const error = page.getByTestId('payment-vendor-casa-solano-error');
    await expect(error).toHaveText('Elige cómo le pagas a este vendedor.');
    await expect(
      page.getByRole('group', { name: 'Cómo le pagas a Casa Solano' }),
    ).toHaveAccessibleDescription('Elige cómo le pagas a este vendedor.');
    await expect(form.getByLabel('Nombre de quien recibe')).toHaveValue(
      'Ana López',
    );
    await expect(page).not.toHaveURL(STATUS_PAGE);

    // Chosen, the same form places the order.
    await page.getByTestId('payment-vendor-casa-solano-cod').check();
    await page.getByTestId('checkout').filter({ visible: true }).click();
    await page.waitForURL(STATUS_PAGE);
  });

  test('sends an empty cart back to the cart, which says why', async ({
    page,
  }) => {
    await page.goto('/es/cart/review');

    await page.waitForURL(/\/es\/cart\?checkout=empty/);
    await expect(page.getByTestId('checkout-empty')).toBeVisible();
  });
});

/**
 * Without script the dynamic pages stream behind Suspense and render empty, so
 * what is proved here is the part a script-free browser relies on: both steps
 * are plain forms. Each is submitted natively — `form.submit()` bypasses
 * React — and still reaches the next step.
 */
test('reviews and places an order through native form submissions', async ({
  page,
}) => {
  await addToCart(page, 'offering-solano-clip-light');

  await page
    .getByTestId('review')
    .evaluate(button => (button as HTMLButtonElement).form?.submit());
  await page.waitForURL(REVIEW_PAGE);

  await fillDelivery(page, { 'vendor-casa-solano': 'cod' });
  await page
    .getByTestId('checkout')
    .filter({ visible: true })
    .evaluate(button => (button as HTMLButtonElement).form?.submit());
  await page.waitForURL(STATUS_PAGE);
  await expect(page.getByTestId('order-pending')).toHaveRole('status');
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
    await expect(page.getByTestId('order-id')).toHaveText(ORDER_NUMBER);
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

  /**
   * #579: the receipt outlives the cancel window (ADR 0076 §6). Past the
   * window the receipt still renders, with no Cancel to offer, and its cookie
   * lives until the group's own `receiptEndsAt` rather than the window.
   */
  test('stays readable past the cancel window, with no Cancel to offer', async ({
    page,
    network,
  }) => {
    const script = scriptStream(network);
    await addToCart(page, 'offering-terra-dinner-plate');
    await startCheckout(page);
    script.outcome = 'flow.completed';

    const order = page.getByTestId('vendor-order-demo-organization');
    await expect(order).toContainText('Demo Vendor');
    await expect(page.getByTestId('cancel-window')).toHaveCount(0);
    await expect(page.getByTestId('cancel-demo-organization')).toHaveCount(0);

    const receipt = (await page.context().cookies()).find(
      cookie => cookie.name === 'r10c_receipt',
    );
    // Days, not the half hour the cancel window lasts: the mock stamps the
    // receipt open into 2099.
    expect(receipt?.expires ?? 0).toBeGreaterThan(
      Date.now() / 1000 + 365 * 24 * 60 * 60,
    );

    await page.reload();
    await expect(order).toContainText('Demo Vendor');
  });

  test('is not shown for a flow this browser never started', async ({
    page,
  }) => {
    await page.goto('/es/order/status/someone-elses-flow');

    await expect(page.getByTestId('receipt-expired')).toBeVisible();
    await expect(page.getByTestId('order-pending')).toHaveCount(0);
  });
});

/**
 * The review step asks where to deliver and how to reach the buyer (#583,
 * ADR 0076 §2). A refused contact comes back with what was typed and an error
 * tied to its field, and nothing the buyer typed ever reaches an address.
 */
const PERSONAL = /Ana|5555|correo|avenida/i;

const reachReview = async (page: Page) => {
  await addToCart(page, 'offering-solano-clip-light');
  await page.getByTestId('review').filter({ visible: true }).click();
  await page.waitForURL(/\/es\/cart\/review/);
};

const refusesAnEmptyPhone = async (page: Page, submit: () => Promise<void>) => {
  await reachReview(page);
  await fillDelivery(page);
  const form = page.getByTestId('delivery-form').filter({ visible: true });
  const phone = form.getByLabel('Teléfono', { exact: true });
  await phone.fill('');
  // Until React runs, the browser validates (#725); this journey is the
  // server's answer, so it waits for the form to hand validation over.
  await expect(form).toHaveAttribute('novalidate', '');

  await submit();

  const error = form.getByTestId('delivery-error-phone');
  await expect(error).toBeVisible();
  await expect(phone).toHaveAttribute('aria-invalid', 'true');
  await expect(phone).toHaveAttribute(
    'aria-describedby',
    new RegExp(String(await error.getAttribute('id'))),
  );
  // Nothing typed is lost to the refusal.
  await expect(
    form.getByLabel('Nombre de quien recibe', { exact: true }),
  ).toHaveValue('Ana López');
  await expect(form.getByLabel('Municipio', { exact: true })).toHaveValue(
    '0108',
  );
  expect(page.url()).not.toMatch(PERSONAL);

  await phone.fill('5555-1234');
};

test.describe('the delivery and contact fields', () => {
  test('answer an empty phone beside the field, then place the order', async ({
    page,
  }) => {
    const visited: string[] = [];
    page.on('framenavigated', frame => visited.push(frame.url()));

    await refusesAnEmptyPhone(page, () =>
      page.getByTestId('checkout').filter({ visible: true }).click(),
    );
    await page.getByTestId('checkout').filter({ visible: true }).click();
    await page.waitForURL(STATUS_PAGE);

    expect(visited.filter(url => PERSONAL.test(url))).toEqual([]);
  });
});

/**
 * The whole storefront order with scripting off (#725): every page on the way
 * renders in the first response, the browser refuses a bad field before
 * anything is posted, and the order-status page offers a button where the
 * stream would have settled it.
 */
test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('a buyer goes from product to receipt', async ({ page }) => {
    await page.goto('/es/p/offering-aurora-desk-lamp');
    await page
      .getByRole('form', { name: 'Comprar' })
      .getByRole('button', { name: 'Añadir al carrito' })
      .click();
    await page.waitForURL(/\/es\/cart(\?|$)/);
    await page.getByTestId('review').click();
    await page.waitForURL(REVIEW_PAGE);

    const form = page.getByTestId('delivery-form');
    await fillDelivery(page);
    const phone = form.getByLabel('Teléfono', { exact: true });
    await phone.fill('12');
    const posts: string[] = [];
    page.on('request', request => {
      if (request.method() === 'POST') posts.push(request.url());
    });

    // Refused by the browser, beside the field, with everything kept.
    await form.getByTestId('checkout').click();
    await expect(phone).toHaveJSProperty('validity.valid', false);
    await expect(phone).toHaveValue('12');
    await expect(
      form.getByLabel('Nombre de quien recibe', { exact: true }),
    ).toHaveValue('Ana López');
    expect(posts).toEqual([]);
    expect(page.url()).toMatch(REVIEW_PAGE);

    await phone.fill('5555-1234');
    await form.getByTestId('checkout').click();
    await page.waitForURL(STATUS_PAGE);

    await page.getByTestId('check-now').getByRole('button').click();
    await expect(page.getByTestId('order-id')).toBeVisible();
  });

  test('a post the server refuses comes back with its errors, never its values', async ({
    page,
  }) => {
    await reachReview(page);
    const form = page.getByTestId('delivery-form');
    await fillDelivery(page);
    await form.getByLabel('Teléfono', { exact: true }).fill('12');
    // A browser that does not validate, or a hand-made post.
    await form.evaluate(element => {
      (element as HTMLFormElement).noValidate = true;
    });
    await form.getByTestId('checkout').click();

    await page.waitForURL(/\/es\/cart\/review\?refused=/);
    expect(page.url()).not.toMatch(PERSONAL);
    expect(page.url()).not.toContain('Ana');
    await expect(form.getByTestId('delivery-error-phone')).toBeVisible();
    await expect(form.getByLabel('Teléfono', { exact: true })).toHaveValue('');
  });
});

/**
 * A seller who does not ship (ADR 0076 §3, §8, #589). The product page offers
 * no Add to cart, so the refusal below is the projection changing between the
 * product page and Place order: a cart that still holds the seller's line.
 */
test.describe('a seller who does not ship', () => {
  test('is named on the cart when the checkout refuses the basket', async ({
    page,
    context,
    baseURL,
  }) => {
    await context.addCookies([
      {
        name: 'r10c_cart',
        value: 'offering-cobalto-arc-lamp:1',
        url: baseURL ?? 'http://localhost:3000',
      },
    ]);
    await page.goto('/es/cart/review');
    await fillDelivery(page);
    await page.getByTestId('checkout').filter({ visible: true }).click();

    await page.waitForURL(/\/es\/cart\?checkout=doesNotShip/);
    await expect(
      page.getByTestId('checkout-doesNotShip').filter({ visible: true }),
    ).toContainText('Cobalto Studio no hace envíos');
  });
});
