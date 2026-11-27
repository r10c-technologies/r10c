import {
  expectAccessible,
  expectAccessibleDialog,
  expectConsistentHelp,
  helpPosition,
  PALETTES,
  usePalette,
} from './a11y';
import { expect, record, test } from './support/fixtures';
import { openVerb } from './support/verbs';

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
  // The vendor's home (#563): no screen type of its own (ADR 0077), only
  // tiles, each one link to the list it counts.
  {
    screen: 'home',
    path: '/es/home',
    ready: { role: 'link', name: /Envíos por despachar/ },
  },
  {
    screen: 'definiciones-brand-list',
    path: '/es/catalog/product-brand',
    ready: { record: 'Acme 1' },
  },
  {
    screen: 'definiciones-device-model-list',
    path: '/es/catalog/device-model',
    ready: { record: 'Samsung Galaxy A15' },
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
  // A catalog from a sheet (ADR 0084): the wizard, and what each import did.
  {
    screen: 'asistentes-catalog-import',
    path: '/es/workspace?tab=wizard:catalog-import',
    ready: { role: 'button', name: 'Continuar' },
  },
  {
    screen: 'definiciones-catalog-import-list',
    path: '/es/catalog/catalog-import',
    ready: { record: 'catalogo-ferreteria.csv' },
  },
  {
    screen: 'consultas-commission-entries',
    path: '/es/settlement/commission-entry',
    ready: { record: '7KQ4-M2XD' },
  },
  {
    screen: 'operaciones-shipment-worklist',
    path: '/es/fulfilment/shipping-order',
    ready: { record: 'A1A1-0001' },
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
  // The screens MVP-4 added or changed (#690): the order a seller confirms a
  // payment on (ADR 0081), the specification a version is released from
  // (ADR 0079), a shipment still waiting for its guide, the settlement
  // statements and the selling channels.
  {
    screen: 'operaciones-orders',
    path: '/es/order/product-order',
    ready: { record: '7KQ4-M2XD' },
  },
  {
    screen: 'order-awaiting-payment',
    path: '/es/order/product-order/product-order-awaiting-link-1',
    ready: { role: 'button', name: 'Confirmar pago' },
  },
  {
    screen: 'definiciones-product-specification',
    // A version in design: the form a person edits.
    path: '/es/catalog/product/product-4',
    ready: { role: 'textbox', name: 'Nombre' },
  },
  {
    // A released version, read-only with the reason and a New version (#767).
    screen: 'definiciones-product-specification-released',
    path: '/es/catalog/product/product-1',
    ready: { role: 'button', name: 'Nueva versión' },
  },
  {
    screen: 'shipment-awaiting-guide',
    path: '/es/fulfilment/shipping-order/ship-a1',
    ready: { role: 'button', name: 'Registrar guía' },
  },
  {
    screen: 'definiciones-agreement',
    path: '/es/settlement/agreement',
    ready: { role: 'heading', name: 'Mi acuerdo', level: 1 },
  },
  {
    screen: 'consultas-vendor-payouts',
    path: '/es/settlement/vendor-payout',
    ready: { role: 'heading', name: 'Mis pagos', level: 1 },
  },
  {
    screen: 'definiciones-sales-channels',
    path: '/es/sales/sales-channel',
    ready: { record: 'Mostrador principal' },
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
    screen: 'account-organization',
    path: '/es/account/organization',
    ready: { role: 'heading', name: 'Datos fiscales', level: 1 },
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

/**
 * The verb forms MVP-4 added open as dialogs, so the page gate never sees
 * them: each is opened the way a seller opens it and gated as a dialog —
 * axe on what is rendered, focus held inside, Escape closing it (#690).
 */
const DIALOGS = [
  {
    screen: 'dialog-price-tiers',
    path: '/es/catalog/product-offering-price/price-1',
    verb: 'Definir precios por volumen',
  },
  {
    screen: 'dialog-sale-unit',
    path: '/es/catalog/product-offering/offering-priced',
    verb: 'Definir unidad de venta',
  },
  {
    screen: 'dialog-stock-source',
    path: '/es/catalog/product-offering/offering-priced',
    verb: 'Vender una presentación del mismo inventario',
  },
  {
    screen: 'dialog-kit',
    path: '/es/catalog/product-offering/offering-priced',
    verb: 'Vender como kit',
  },
] as const;

for (const palette of PALETTES) {
  test(`every verb form meets the gate in ${palette}`, async ({ page }) => {
    test.setTimeout(DIALOGS.length * 20_000);
    await usePalette(page, palette);

    for (const { screen, path, verb } of DIALOGS) {
      await test.step(screen, async () => {
        await page.goto(path);
        await openVerb(page, verb);
        await expectAccessibleDialog(
          page,
          page.getByRole('dialog', { name: verb }),
          `${screen}:${palette}`,
        );
      });
    }
  });
}
