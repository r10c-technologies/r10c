import {
  expectAccessible,
  expectConsistentHelp,
  helpPosition,
  PALETTES,
  usePalette,
} from './a11y';
import { fillDelivery } from './support/delivery';
import { expect, scriptStream, test } from './support/stream-fixture';

/**
 * The accessibility gate on every storefront screen (ADR 0075), in both
 * palettes: the home, a category, a search, a seller's page, a product, the cart, a receipt and
 * the not-found page. One test per palette walks them in a buyer's order — the
 * cart is filled from the product page and the receipt is the checkout's own
 * outcome — so the 3.2.6 assertion can compare every screen.
 */
for (const palette of PALETTES) {
  test(`every storefront screen meets the gate in ${palette}`, async ({
    page,
    network,
  }) => {
    test.setTimeout(240_000);
    const script = scriptStream(network);
    await usePalette(page, palette);
    const help: (number | null)[] = [];
    // From a filled cart to a settled receipt, the way a buyer gets there.
    const placeFromCart = async () => {
      await page.waitForURL(/\/es\/cart(\?|$)/);
      await page.getByTestId('review').filter({ visible: true }).click();
      await page.waitForURL(/\/es\/cart\/review/);
      await fillDelivery(page);
      await page.getByTestId('checkout').filter({ visible: true }).click();
      await page.waitForURL(/\/es\/order\/status\/e2e-flow-/);
      script.outcome = 'flow.completed';
      await expect(page.getByTestId('order-id')).toBeVisible();
    };
    const gate = async (screen: string) => {
      await expect(page.locator('html')).toHaveAttribute('data-theme', palette);
      await expectAccessible(page, `${screen}:${palette}`);
      help.push(await helpPosition(page));
    };

    await test.step('home', async () => {
      await page.goto('/es');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await gate('home');
    });

    await test.step('category', async () => {
      await page.goto('/es/c/lighting');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await gate('category');
    });

    await test.step('search', async () => {
      await page.goto('/es/search?q=a');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await gate('search');
    });

    await test.step('seller', async () => {
      await page.goto('/es/s/demo-organization');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await gate('seller');
    });

    await test.step('product', async () => {
      await page.goto('/es/p/offering-aurora-desk-lamp');
      await expect(page.getByRole('form', { name: 'Comprar' })).toBeVisible();
      await gate('product');
    });

    await test.step('cart', async () => {
      await page
        .getByRole('form', { name: 'Comprar' })
        .getByRole('button', { name: 'Añadir al carrito' })
        .click();
      await page.waitForURL(/\/es\/cart(\?|$)/);
      await expect(
        page.getByTestId('review').filter({ visible: true }),
      ).toBeVisible();
      await gate('cart');
    });

    await test.step('review', async () => {
      await page.getByTestId('review').filter({ visible: true }).click();
      await page.waitForURL(/\/es\/cart\/review/);
      await expect(
        page.getByTestId('checkout').filter({ visible: true }),
      ).toBeVisible();
      await gate('review');
    });

    // The delivery form after a checkout with nothing filled: every error
    // is announced and tied to its field (3.3.1, 3.3.3).
    await test.step('review with errors', async () => {
      await page.getByTestId('checkout').filter({ visible: true }).click();
      await expect(
        page.getByTestId('delivery-error-name').filter({ visible: true }),
      ).toBeVisible();
      await gate('review-errors');
    });

    await test.step('receipt', async () => {
      await fillDelivery(page);
      await fillDelivery(page);
      await page.getByTestId('checkout').filter({ visible: true }).click();
      await page.waitForURL(/\/es\/order\/status\/e2e-flow-/);
      script.outcome = 'flow.completed';
      await expect(page.getByTestId('order-id')).toBeVisible();
      await gate('receipt');
    });

    // After the cancel the page reloads onto the cancelled receipt; the walk
    // proves focus lands somewhere a keyboard user can continue from, never
    // on `<body>` (#525).
    await test.step('cancelled receipt', async () => {
      await page
        .getByTestId('cancel-demo-organization')
        .getByRole('button', { name: 'Cancelar pedido' })
        .click();
      await page
        .getByRole('alertdialog')
        .getByRole('button', { name: 'Cancelar pedido y reembolsar' })
        .click();
      await page.waitForURL(/cancel=cancelled/);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(
        'Pedido cancelado',
      );
      await gate('cancelled');
    });

    await test.step('find my order', async () => {
      await page.goto('/es/order/find');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await gate('find');
    });

    await test.step('find my order, sent', async () => {
      await page.goto('/es/order/find');
      await page.getByLabel('Número de pedido').fill('ZZZZ-ZZZZ');
      await page.getByLabel('Correo electrónico').fill('nadie@ejemplo.com');
      await page.getByRole('button', { name: 'Enviarme un enlace' }).click();
      await page.waitForURL(/\/es\/order\/find\/sent$/);
      await expect(
        page.getByTestId('find-sent').filter({ visible: true }),
      ).toBeVisible();
      await gate('find-sent');
    });

    // A product sold by the metre with volume prices (ADR 0082), bought and
    // read back on its way, with its guide and its FEL document (#668 #669).
    await test.step('product in a unit, with volume prices', async () => {
      await page.goto('/es/p/offering-coax-cable');
      await expect(page.getByTestId('price-tiers')).toBeVisible();
      await gate('product-tiers');
    });

    await test.step('receipt in transit', async () => {
      await page
        .getByRole('form', { name: 'Comprar' })
        .getByRole('button', { name: 'Añadir al carrito' })
        .click();
      await placeFromCart();
      await expect(page.getByTestId('vendor-order-fiscal')).toBeVisible();
      await gate('receipt-in-transit');
    });

    // A payment-link order waiting for its payment (ADR 0081): the link, the
    // due date and the receipt upload.
    await test.step('receipt awaiting payment', async () => {
      await page.goto('/es/p/offering-eclipse-runner');
      await page
        .getByRole('form', { name: 'Comprar' })
        .getByRole('button', { name: 'Añadir al carrito' })
        .click();
      await placeFromCart();
      await expect(page.locator('input[type="file"]').first()).toBeAttached();
      await gate('receipt-awaiting-payment');
    });

    await test.step('access link', async () => {
      await page.goto('/es/order/access?token=e2e-token-none');
      await expect(
        page.getByTestId('access-form').filter({ visible: true }),
      ).toBeVisible();
      await gate('access');
    });

    await test.step('not-found', async () => {
      await page.goto('/es/p/no-such-offering');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await gate('not-found');
    });

    expectConsistentHelp(help);
  });
}
