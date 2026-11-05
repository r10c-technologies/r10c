import { expect, test } from './support/fixtures';

/**
 * A breadcrumb names a place exactly as the sidebar does (#531). Six shells
 * rendered the raw URL segment instead — `product-order`, `shipping-order` —
 * because the host hand-listed crumb labels and only knew the catalog's. The
 * crumbs now resolve from the sidebar's own keys.
 *
 * `inSidebar: false` marks the one screen the mock persona's organization is
 * not provisioned to see in the sidebar (ADR 0037); its crumb still resolves,
 * which is the point — a crumb is not a grant.
 */
const SCREENS = [
  { path: '/order/product-order', label: 'Pedidos', inSidebar: false },
  {
    path: '/stock/stock-item',
    label: 'Existencias en almacén',
    inSidebar: true,
  },
  { path: '/settlement/agreement', label: 'Acuerdos', inSidebar: true },
  { path: '/fulfilment/shipping-order', label: 'Envíos', inSidebar: true },
  { path: '/sales/sales-channel', label: 'Canales de venta', inSidebar: true },
  { path: '/users', label: 'Usuarios', inSidebar: true },
] as const;

for (const { path, label, inSidebar } of SCREENS) {
  test(`the breadcrumb on ${path} reads as its sidebar item`, async ({
    page,
  }) => {
    await page.goto(path);

    const trail = page.getByRole('navigation', { name: 'Ruta de navegación' });
    // The current crumb: a section titled like its one item (Pedidos › Pedidos)
    // names the same words twice in the trail.
    await expect(trail.locator('[aria-current="page"]')).toHaveText(label);
    await expect(trail).not.toContainText(path.split('/').at(-1) as string);

    if (inSidebar) {
      // The accessible name, so the item's glyph is not part of the match.
      await expect(
        page
          .getByRole('navigation', { name: 'Principal' })
          .getByRole('link', { name: label, exact: true })
          .first(),
      ).toHaveAttribute('href', `/es${path}`);
    }
  });
}
