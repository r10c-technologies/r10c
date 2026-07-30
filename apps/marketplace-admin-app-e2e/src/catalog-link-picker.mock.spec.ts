import type { Page } from '@playwright/test';
import type { NetworkFixture } from '@r10c/entifix-ts-testing-e2e/playwright';
import { http, HttpResponse } from 'msw';

import { expect, PRODUCT_URL, test } from './support/fixtures';

/**
 * Setting a product's relations, and what that puts on the wire.
 *
 * The two ways in are deliberately both exercised: the quick type-ahead ("I know
 * roughly what it is called") and the browse dialog over the target's own table
 * ("I need to filter the catalog"). Neither could be asserted against a preloaded
 * option list — a picker that pages and searches is the point.
 *
 * The payload assertion is the other half: `brand` declares
 * `linkSerialization: 'embedded'` on the entity and `category` keeps the default,
 * so one relation must leave as an inlined object and the other as a bare key.
 * That is a property of the entity, and this is where it is verified end to end.
 *
 * Mock-only by nature: observing the request body means choosing the response.
 */

/** Captures the create payload and answers with a readable envelope. */
const captureCreate = (network: NetworkFixture): { body?: unknown } => {
  const captured: { body?: unknown } = {};
  network.use(
    http.post(PRODUCT_URL, async ({ request }) => {
      const envelope = (await request.json()) as {
        meta: unknown;
        data: Record<string, unknown>;
      };
      captured.body = envelope.data;
      // Echo it back: the client deserializes the *response*, because the
      // service is the authority on the stored entity.
      return HttpResponse.json({
        meta: envelope.meta,
        data: { ...envelope.data, id: 'product-99' },
      });
    }),
  );
  return captured;
};

const openCreateForm = async (page: Page) => {
  await page.goto('/catalog/product/new');
  await expect(page.getByLabel('Código')).toBeVisible();
};

/** Types a term into one relation's quick search and takes the named match. */
const quickPick = async (page: Page, field: string, option: string) => {
  await page.getByLabel(`Buscar ${field}`).fill(option);
  await page.getByRole('option', { name: option, exact: true }).click();
};

/** Opens one relation's dialog and selects the row carrying `option`. */
const browsePick = async (page: Page, field: string, option: string) => {
  await page.getByRole('button', { name: `Examinar ${field}` }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  await dialog
    .getByRole('row')
    .filter({ hasText: option })
    .getByRole('button', { name: 'Seleccionar' })
    .click();
  await expect(dialog).toBeHidden();
};

test('sets both relations, each through a different picker', async ({
  page,
  network,
}) => {
  const created = captureCreate(network);

  await openCreateForm(page);
  await page.getByLabel('Código').fill('P-9');
  await page.getByLabel('Nombre').fill('Widget 9');

  // Quick: a term the service has to filter on — `Globex 2` is not on the first
  // page of suggestions.
  await quickPick(page, 'Marca', 'Globex 2');
  await expect(page.getByTestId('entity-link-value-brand')).toHaveText(
    'Globex 2',
  );

  // Browse: the target entity's own table, inside a dialog.
  await browsePick(page, 'Categoría', 'Globex tools 2');
  await expect(page.getByTestId('entity-link-value-category')).toHaveText(
    'Globex tools 2',
  );

  await page.getByRole('button', { name: 'Guardar' }).click();

  await expect.poll(() => created.body).toBeDefined();
  const body = created.body as Record<string, unknown>;
  // The declared shapes: brand inlined, category a scalar key.
  expect(body['brand']).toMatchObject({ name: 'Globex 2' });
  expect(body['category']).toBe('product-category-2');
});

test('reads a stored relation back as a name, not as a key', async ({
  page,
}) => {
  await page.goto('/catalog/product/product-1');

  // `brand` arrived embedded, so the name is in the payload; `category` arrived
  // as a foreign key and is resolved through the picker's get use-case. Both must
  // read as names — a key on screen is the failure this covers.
  await expect(page.getByTestId('entity-link-value-brand')).toHaveText('Acme 1');
  await expect(page.getByTestId('entity-link-value-category')).toHaveText(
    'Globex tools 2',
  );
});

test('clears a relation the user removes', async ({ page, network }) => {
  const created = captureCreate(network);

  await openCreateForm(page);
  await page.getByLabel('Código').fill('P-8');
  await page.getByLabel('Nombre').fill('Widget 8');
  await quickPick(page, 'Marca', 'Acme 1');

  await page.getByRole('button', { name: 'Quitar Marca' }).click();
  await expect(page.getByTestId('entity-link-value-brand')).toHaveText(
    '— sin asignar —',
  );

  await page.getByRole('button', { name: 'Guardar' }).click();

  await expect.poll(() => created.body).toBeDefined();
  expect((created.body as Record<string, unknown>)['brand']).toBeUndefined();
});
