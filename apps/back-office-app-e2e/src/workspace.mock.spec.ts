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
 * The draft it protects is written on every keystroke: `EntityCrudForm` fires
 * `onDraftChange` from an effect over `form.values` while the form is dirty
 * (no debounce), and the workspace binds that to the tab's own address. So
 * typing a single character is enough to make a tab dirty.
 *
 * Mock-only because it is about the browser's state machine, not the service:
 * the seeded `product-1` is a fixture either profile could serve, but the
 * assertions are all client-side.
 */

const PRODUCT_TAB = 'entity:product-specification:product-1';
const CLOSE_PRODUCT = 'Cerrar Producto #product-1';

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

test('closes a clean tab with no confirmation at all', async ({ page }) => {
  forbidNativeDialogs(page);
  await page.goto('/workspace?tab=catalog:product-specification');

  const tab = page.getByRole('tab', { name: 'Productos' });
  await expect(tab).toBeVisible();

  await page.getByRole('button', { name: 'Cerrar Productos' }).click();

  await expect(tab).toBeHidden();
  await expect(page.getByTestId('confirm-dialog')).toHaveCount(0);
});
