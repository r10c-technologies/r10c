import { expect, record, test } from './support/fixtures';

/**
 * The offering list says what a vendor checks their range for (#558): a
 * price and a picture, without opening each record or another screen. Each is a related column — one read per column per page,
 * through the slice that owns the value (entifix 0030).
 */
test.describe('the offering list', () => {
  test('shows each offering’s price and picture', async ({ page }) => {
    await page.goto('/es/catalog/product-offering');

    const row = record(page, 'Taza de cerámica');
    await expect(row).toContainText(/45,00/);
    await expect(row.getByRole('img')).toHaveAttribute(
      'alt',
      'Un widget azul sobre fondo blanco',
    );
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
    await expect(record(page, 'Taza de cerámica')).toContainText(/45,00/);

    const count = (path: string) =>
      reads.filter(read => read.endsWith(path)).length;
    expect(count('/product-offering-price')).toBe(1);
  });
});
