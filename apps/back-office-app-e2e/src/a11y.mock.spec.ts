import {
  expectAccessible,
  expectConsistentHelp,
  helpPosition,
  PALETTES,
  usePalette,
} from './a11y';
import { expect, record, test } from './support/fixtures';

/**
 * The accessibility gate on every back-office screen type (ADR 0075): one
 * representative per ADR 0033 type, and the screens whose failures the live
 * audit found, in both gated palettes.
 *
 * Each screen is reached the way a user reaches it and waited on for what it
 * exists to show, because axe judges what is rendered: a list still loading
 * would pass for want of rows. One test per palette walks every screen, so the
 * 3.2.6 assertion can compare them.
 */
const SCREENS = [
  {
    screen: 'definiciones-brand-list',
    path: '/es/catalog/product-brand',
    ready: { record: 'Acme 1' },
  },
  // The product workspace (#564): a form with three slices' regions under it.
  {
    screen: 'definiciones-product-workspace',
    path: '/es/catalog/product-offering/product-offering-1',
    ready: { role: 'region', name: 'Existencias' },
  },
  {
    screen: 'operaciones-stock-items',
    path: '/es/stock/stock-item',
    ready: { record: 'Taza de cerámica' },
  },
  {
    screen: 'asistentes-product-wizard',
    path: '/es/workspace?tab=wizard:product-setup',
    ready: { role: 'button', name: 'Continuar' },
  },
  {
    screen: 'consultas-commission-entries',
    path: '/es/settlement/commission-entry',
    ready: { record: 'order-1' },
  },
  {
    screen: 'operaciones-shipment-worklist',
    path: '/es/fulfilment/shipping-order',
    ready: { record: /ord-a1/ },
  },
  {
    screen: 'shipment-detail',
    path: '/es/fulfilment/shipping-order/ship-d1',
    ready: { role: 'button', name: 'Registrar entrega' },
  },
  {
    screen: 'till',
    path: '/es/sales/counter-sale',
    ready: { role: 'radiogroup', name: 'Canal' },
  },
  {
    screen: 'account',
    path: '/es/account',
    ready: { role: 'heading', name: 'Mi cuenta', level: 1 },
  },
  {
    screen: 'account-sessions',
    path: '/es/account/sessions',
    ready: { role: 'heading', name: 'Sesiones activas', level: 1 },
  },
  {
    screen: 'user-create',
    path: '/es/users/new',
    ready: { role: 'textbox', name: 'Correo' },
  },
  {
    screen: 'configuration',
    path: '/es/system/configuration',
    ready: { record: 'stock-service-domain' },
  },
] as const;

for (const palette of PALETTES) {
  test(`every screen type meets the gate in ${palette}`, async ({ page }) => {
    // About twenty seconds a screen, the keyboard walk being most of it.
    test.setTimeout(SCREENS.length * 25_000);
    await usePalette(page, palette);
    const help: (number | null)[] = [];

    for (const { screen, path, ready } of SCREENS) {
      await test.step(screen, async () => {
        await page.goto(path);
        // A list waits on one of its records, in whichever layout it is in:
        // a wide list pivots to cards at the default viewport (entifix ADR
        // 0027), and the gate judges whichever one a user is shown.
        if ('record' in ready) {
          await expect(record(page, ready.record).first()).toBeVisible();
        } else {
          const { role, ...options } = ready;
          await expect(page.getByRole(role, options).first()).toBeVisible();
        }
        await expect(page.locator('html')).toHaveAttribute(
          'data-theme',
          palette,
        );
        await expectAccessible(page, `${screen}:${palette}`);
        help.push(await helpPosition(page));
      });
    }

    expectConsistentHelp(help);
  });
}
