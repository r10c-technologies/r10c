import type { Page } from '@playwright/test';

import { expect, test } from './support/fixtures';

/**
 * Closing a workspace tab that holds an unsaved draft.
 *
 * This is the suite's first workspace journey, and the reason it did not exist
 * before is the thing being changed: the guard was `window.confirm`, and a
 * native dialog can only be driven from a global `page.on('dialog')` handler
 * registered before the click — out of band from the assertion it belongs to.
 * A rendered `ConfirmDialog` is just another element, so the tab's whole
 * lifecycle is one linear script.
 *
 * The draft it protects is written on every keystroke: `useEntityForm` writes
 * to its draft port from an effect over its own values while the form differs
 * from its seed (no debounce), and the workspace binds that port to the tab's
 * own address through `useEntityDraft`. So typing a single character is enough
 * to make a tab dirty.
 *
 * That seam used to be per-page plumbing, which is why the brand journey below
 * exists: brand and category tabs had no draft at all — no autosave, no dirty
 * marker, and closing one lost the edit with no confirmation (#131).
 *
 * Mock-only because it is about the browser's state machine, not the service:
 * the seeded `product-1` is a fixture either profile could serve, but the
 * assertions are all client-side.
 */

const PRODUCT_TAB = 'entity:product-specification:product-1';
const CLOSE_PRODUCT = 'Cerrar Producto #product-1';
const BRAND_TAB = 'entity:product-brand:product-brand-1';
const CLOSE_BRAND = 'Cerrar Marca #product-brand-1';

/** Fails the test if anything reaches for the native dialog we just removed. */
const forbidNativeDialogs = (page: Page) => {
  page.on('dialog', dialog => {
    throw new Error(`unexpected native ${dialog.type()}: ${dialog.message()}`);
  });
};

/** Opens the product editor in a tab and makes it dirty. */
const openDirtyTab = async (page: Page) => {
  await page.goto(`/workspace?tab=${PRODUCT_TAB}`);

  const name = page.getByLabel('Nombre');
  await expect(name).toHaveValue('Widget');
  await name.fill('Widget renamed');

  // The strip's dirty marker is what says the draft actually landed, rather
  // than the keystroke merely reaching the input.
  await expect(page.getByTestId('tab-indicator')).toBeVisible();
};

test('keeps a dirty tab and its draft when the discard is cancelled', async ({
  page,
}) => {
  forbidNativeDialogs(page);
  await openDirtyTab(page);

  await page.getByRole('button', { name: CLOSE_PRODUCT }).click();

  const dialog = page.getByTestId('confirm-dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancelar' }).click();

  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole('tab', { name: /Producto #product-1/ }),
  ).toBeVisible();
  // The edit survives too — a tab that stayed while its draft was dropped
  // would satisfy the assertion above and still have lost the work.
  await expect(page.getByLabel('Nombre')).toHaveValue('Widget renamed');
});

test('closes a dirty tab and drops its draft when the discard is confirmed', async ({
  page,
}) => {
  forbidNativeDialogs(page);
  await openDirtyTab(page);

  await page.getByRole('button', { name: CLOSE_PRODUCT }).click();
  await page
    .getByTestId('confirm-dialog')
    .getByRole('button', { name: 'Descartar' })
    .click();

  await expect(
    page.getByRole('tab', { name: /Producto #product-1/ }),
  ).toBeHidden();

  // Reopening the same address gets the stored record, not the abandoned edit:
  // the draft is keyed by that address in IndexedDB, so a surviving one would
  // come straight back.
  await page.goto(`/workspace?tab=${PRODUCT_TAB}`);
  await expect(page.getByLabel('Nombre')).toHaveValue('Widget');
});

/**
 * The same journey on a brand, which is the regression #131 closes: the two
 * catalog editors reached the generated page with no draft, so this tab was
 * never dirty and its close was never guarded. Nothing here is brand-specific —
 * that is the point, the seam is the entity's metadata and one hook.
 */
test('autosaves and guards a brand tab, not only the product one', async ({
  page,
}) => {
  forbidNativeDialogs(page);
  await page.goto(`/workspace?tab=${BRAND_TAB}`);

  const name = page.getByLabel('Nombre');
  await expect(name).toHaveValue('Acme 1');
  await name.fill('Acme renamed');
  await expect(page.getByTestId('tab-indicator')).toBeVisible();

  // The edit survives a reload, which is the whole feature: the form seeds from
  // the persisted draft rather than from the record.
  await page.reload();
  await expect(page.getByLabel('Nombre')).toHaveValue('Acme renamed');

  await page.getByRole('button', { name: CLOSE_BRAND }).click();
  await page
    .getByTestId('confirm-dialog')
    .getByRole('button', { name: 'Descartar' })
    .click();

  await page.goto(`/workspace?tab=${BRAND_TAB}`);
  await expect(page.getByLabel('Nombre')).toHaveValue('Acme 1');
});

test('closes a clean tab with no confirmation at all', async ({ page }) => {
  forbidNativeDialogs(page);
  await page.goto('/workspace?tab=catalog:product-specification');

  const tab = page.getByRole('tab', { name: 'Productos' });
  await expect(tab).toBeVisible();

  await page.getByRole('button', { name: 'Cerrar Productos' }).click();

  await expect(tab).toBeHidden();
  await expect(page.getByTestId('confirm-dialog')).toHaveCount(0);
});
