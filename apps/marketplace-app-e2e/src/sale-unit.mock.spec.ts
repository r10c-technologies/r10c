import { baseTest as test, expect } from '@entifix/testing-e2e/playwright';

/**
 * Buying something sold in a unit that is not a piece (ADR 0082): a cable by
 * the half metre from one metre, at Q45.00 the metre. A quantity is typed in
 * metres, held in the metre's scale, refused — never rounded — when the
 * offering does not sell it, and read back with its unit wherever it shows.
 */
const CABLE = '/es/p/offering-coax-cable';

test.describe('a product sold by the metre', () => {
  test('is bought in metres, priced by its line total, and reads with its unit', async ({
    page,
  }) => {
    await page.goto(CABLE);
    const buy = page.getByRole('form', { name: 'Comprar' });
    const quantity = buy.getByRole('spinbutton', { name: 'Cantidad' });
    // It starts at what is sold first, and says how it is sold.
    await expect(quantity).toHaveValue('1');
    await expect(buy).toContainText('Desde 1 m, de 0.5 m en 0.5 m');

    await quantity.fill('3.5');
    await buy.getByRole('button', { name: 'Añadir al carrito' }).click();
    await page.waitForURL(/\/es\/cart(\?|$)/);

    // 3.5 m at Q45.00 the metre is Q157.50, never 3500 × Q45.00.
    await expect(page.getByTestId('cart-line-price')).toContainText(
      /(?<!GT)Q\s157\.50/,
    );
    await expect(page.getByTestId('cart-total')).toContainText(
      /(?<!GT)Q\s157\.50/,
    );
    await expect(
      page.getByRole('spinbutton', { name: 'Cantidad de Coax Cable' }),
    ).toHaveValue('3.5');
    // One line, whatever its quantity.
    await expect(
      page.getByRole('link', { name: 'Carrito (1 artículo)' }),
    ).toBeVisible();

    await page.getByTestId('review').click();
    await page.waitForURL(/\/es\/cart\/review/);
    await expect(page.getByText(/Coax Cable · Cant\. 3\.5 m/)).toBeVisible();
  });

  test('refuses a quantity off its step, and the cart says why', async ({
    page,
  }) => {
    await page.goto(CABLE);
    const buy = page.getByRole('form', { name: 'Comprar' });
    await buy.getByRole('spinbutton', { name: 'Cantidad' }).fill('1.2');
    await buy.getByRole('button', { name: 'Añadir al carrito' }).click();

    await page.waitForURL(/\/es\/cart\?refused=offering-coax-cable/);
    await expect(page.getByTestId('cart-refused')).toContainText(
      'No se cambió Coax Cable en el carrito.',
    );
    await expect(page.getByTestId('cart-refused')).toContainText(
      'Desde 1 m, de 0.5 m en 0.5 m',
    );
    // Refused rather than rounded: nothing was added.
    await expect(page.getByText('Tu carrito está vacío.')).toBeVisible();
  });

  test('refuses a cart change off its step and keeps the line as it was', async ({
    page,
  }) => {
    await page.goto(CABLE);
    await page
      .getByRole('form', { name: 'Comprar' })
      .getByRole('button', { name: 'Añadir al carrito' })
      .click();
    await page.waitForURL(/\/es\/cart(\?|$)/);

    const quantity = page.getByRole('spinbutton', {
      name: 'Cantidad de Coax Cable',
    });
    await quantity.fill('0.7');
    await page.getByRole('button', { name: 'Actualizar' }).click();

    await page.waitForURL(/\/es\/cart\?refused=/);
    await expect(page.getByTestId('cart-refused')).toBeVisible();
    await expect(page.getByTestId('cart-line-price')).toContainText(
      /(?<!GT)Q\s45\.00/,
    );
  });

  test('blocks the review of a line its terms no longer sell', async ({
    page,
    baseURL,
  }) => {
    // 1.2 m: a quantity the seller's half-metre step does not sell — what a
    // cart holds after the step changed under it.
    await page.context().addCookies([
      {
        name: 'r10c_cart',
        value: 'offering-coax-cable:1200',
        url: baseURL ?? 'http://localhost:3000',
      },
    ]);
    await page.goto('/es/cart');

    await expect(page.getByTestId('cart-line-refused')).toBeVisible();
    await expect(page.getByTestId('cart-blocked')).toBeVisible();
    await expect(page.getByTestId('review')).toHaveCount(0);

    // Nor does the review let it through by its address.
    await page.goto('/es/cart/review');
    await page.waitForURL(/\/es\/cart\?checkout=quantity/);
    await expect(page.getByTestId('checkout-quantity')).toBeVisible();
  });
});

test.describe('a product sold by the metre, with no script', () => {
  test.use({ javaScriptEnabled: false });

  test('is bought in metres, and a quantity off its step is refused', async ({
    page,
  }) => {
    await page.goto(CABLE);
    const buy = page.getByRole('form', { name: 'Comprar' });
    const quantity = buy.getByRole('spinbutton', { name: 'Cantidad' });

    await quantity.fill('1.2');
    await buy.getByRole('button', { name: 'Añadir al carrito' }).click();
    await page.waitForURL(/\/es\/cart\?refused=/);
    await expect(page.getByTestId('cart-refused')).toBeVisible();

    await page.goto(CABLE);
    await quantity.fill('2.5');
    await buy.getByRole('button', { name: 'Añadir al carrito' }).click();
    await page.waitForURL(/\/es\/cart(\?added=|$)/);
    await expect(page.getByTestId('cart-line-price')).toContainText(
      /(?<!GT)Q\s112\.50/,
    );
  });
});
