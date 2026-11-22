import { seedSession } from '@entifix/testing-e2e/playwright';

import { expect, record, test } from './support/fixtures';

/**
 * The offering list says what a vendor checks their range for (#558): a
 * price, a picture and how much is available, without opening each record or
 * two other screens. Each is a related column — one read per column per page,
 * through the slice that owns the value (entifix 0030).
 */
test.describe('the offering list', () => {
  test('shows each offering’s price, picture and available stock', async ({
    page,
  }) => {
    await page.goto('/es/catalog/product-offering');

    const row = record(page, 'Taza de cerámica');
    await expect(row).toContainText(/(?<!GT)Q\s45\.00/);
    await expect(row.getByRole('img')).toHaveAttribute(
      'alt',
      'Un widget azul sobre fondo blanco',
    );
    await expect(
      page.getByRole('columnheader', { name: 'Disponible' }),
    ).toBeVisible();
    await expect(row).toContainText('10');
    // An offering nobody priced reads as nothing, not as zero.
    await expect(record(page, 'Plato hondo')).toContainText('—');
  });

  test('reads each related value once per page', async ({ page }) => {
    const reads: string[] = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (request.method() === 'GET' && /\/api\//.test(url.pathname)) {
        reads.push(url.pathname);
      }
    });

    await page.goto('/es/catalog/product-offering');
    await expect(record(page, 'Taza de cerámica')).toContainText(
      /(?<!GT)Q\s45\.00/,
    );
    await expect(record(page, 'Taza de cerámica')).toContainText('10');

    const count = (path: string) =>
      reads.filter(read => read.endsWith(path)).length;
    expect(count('/product-offering-price')).toBe(1);
    expect(count('/stock-item')).toBe(1);
  });

  test('has no stock column for a reader who may not see stock', async ({
    page,
    context,
  }) => {
    await seedSession(context, {
      roles: ['admin'],
      entitlements: ['product-configuration-management'],
    });
    await page.goto('/es/catalog/product-offering');

    await expect(record(page, 'Taza de cerámica')).toContainText(
      /(?<!GT)Q\s45\.00/,
    );
    await expect(
      page.getByRole('columnheader', { name: 'Disponible' }),
    ).toHaveCount(0);
  });
});
