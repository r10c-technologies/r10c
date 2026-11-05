import {
  expectAccessible,
  expectConsistentHelp,
  helpPosition,
  PALETTES,
  usePalette,
} from './a11y';
import { expect, scriptStream, test } from './support/stream-fixture';

/**
 * The accessibility gate on every storefront screen (ADR 0075), in both
 * palettes: the home, a category, a search, a product, the cart, a receipt and
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
      await page.waitForURL(/\/es\/cart$/);
      await expect(page.getByTestId('checkout')).toBeVisible();
      await gate('cart');
    });

    await test.step('receipt', async () => {
      await page.getByTestId('checkout').click();
      await page.waitForURL(/\/es\/order\/status\/e2e-flow-/);
      script.outcome = 'flow.completed';
      await expect(page.getByTestId('order-id')).toBeVisible();
      await gate('receipt');
    });

    await test.step('not-found', async () => {
      await page.goto('/es/p/no-such-offering');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await gate('not-found');
    });

    expectConsistentHelp(help);
  });
}
