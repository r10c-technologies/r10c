import {
  expectAccessible,
  expectConsistentHelp,
  helpPosition,
  PALETTES,
  usePalette,
} from './a11y';
import { expect, test } from './support/fixtures';

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
    ready: { role: 'cell', name: 'Acme 1' },
  },
  {
    screen: 'operaciones-stock-items',
    path: '/es/stock/stock-item',
    ready: { role: 'table' },
  },
  {
    screen: 'asistentes-product-wizard',
    path: '/es/workspace?tab=wizard:product-setup',
    ready: { role: 'button', name: 'Continuar' },
  },
  {
    screen: 'consultas-commission-entries',
    path: '/es/settlement/commission-entry',
    ready: { role: 'table' },
  },
  {
    screen: 'till',
    path: '/es/sales/counter-sale',
    ready: { role: 'combobox', name: 'Canal' },
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
    ready: { role: 'button', name: 'Crear usuario' },
  },
  {
    screen: 'configuration',
    path: '/es/system/configuration',
    ready: { role: 'cell', name: 'stock-service-domain' },
  },
] as const;

for (const palette of PALETTES) {
  test(`every screen type meets the gate in ${palette}`, async ({ page }) => {
    test.setTimeout(240_000);
    await usePalette(page, palette);
    const help: (number | null)[] = [];

    for (const { screen, path, ready } of SCREENS) {
      await test.step(screen, async () => {
        await page.goto(path);
        const { role, ...options } = ready;
        await expect(page.getByRole(role, options).first()).toBeVisible();
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
