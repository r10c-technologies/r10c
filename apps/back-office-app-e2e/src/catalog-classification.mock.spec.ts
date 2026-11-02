import type { NetworkFixture } from '@entifix/testing-e2e/playwright';
import type { Page } from '@playwright/test';
import { http, HttpResponse } from 'msw';

import { expect, PRODUCT_URL, test } from './support/fixtures';

/**
 * Setting a specification's brand and category, and what that puts on the wire.
 *
 * Both are **pickers over plain ids**. Their targets moved to
 * `catalog-reference` — a platform-plane store owned by another slice — so
 * `ProductSpecification` carries `brandId` / `categoryId` strings rather than
 * `link` members ([ADR 0022](../../../docs/adr/0022-v1-marketplace-module-boundaries.md)),
 * and the editor writes the chosen target's id straight into the draft. Two
 * things are therefore worth asserting end to end: that a *name* is what an
 * operator picks and reads back, and that an *id* is what reaches the service —
 * absent, not `''`, when the field is emptied.
 *
 * The search half is not decoration. The mock backend runs the real query
 * pipeline and answers the same `400` the service does for a member the entity
 * never declared `filterable`, which the picker would render as an empty
 * suggestion list. Typing a term and getting a row back is what proves
 * `ProductBrand.name` is still queryable.
 *
 * Mock-only by nature: observing the request body means choosing the response.
 */

/**
 * Captures the created entity and answers the way the real service does: the
 * record as stored, under the code it drew. What is asserted below is the
 * record's members, which are the part the picker actually decides.
 */
const captureCreate = (network: NetworkFixture): { body?: unknown } => {
  const captured: { body?: unknown } = {};
  network.use(
    http.post(PRODUCT_URL, async ({ request }) => {
      const envelope = (await request.json()) as {
        meta: { entity: string };
        data: Record<string, unknown>;
      };
      captured.body = envelope.data;
      return HttpResponse.json({
        meta: { type: 'entity', entity: envelope.meta.entity },
        data: { ...envelope.data, id: 'spec-created', code: 'product-901' },
      });
    }),
  );
  return captured;
};

const openCreateForm = async (page: Page) => {
  await page.goto('/catalog/product/new');
  // `Nombre` and not `Código`: the create draws the code from the
  // organization's counter, so the form does not ask for one.
  await expect(page.getByLabel('Nombre')).toBeVisible();
};

/** The held id, which the picker renders as a name once it resolves. */
const heldValue = (page: Page, field: string) =>
  page.getByTestId(`entity-link-value-${field}`);

/**
 * Picks a target by typing part of its name and clicking the suggestion.
 *
 * The seed cycles ten base names across 20 brands and 14 categories, so a term
 * matches several rows and the exact option name is what makes the choice
 * unambiguous — the point being that the row came back from a filtered query
 * rather than from a preloaded first page.
 */
const pickByName = async (page: Page, field: string, name: string) => {
  await page.getByRole('combobox', { name: `Buscar ${field}` }).fill(name);
  await page.getByRole('option', { name, exact: true }).click();
};

test('sends both classifications as scalar ids', async ({ page, network }) => {
  const captured = captureCreate(network);
  await openCreateForm(page);

  await page.getByLabel('Nombre').fill('Widget 100');
  await pickByName(page, 'Marca', 'Acme 1');
  await pickByName(page, 'Categoría', 'Acme tools 1');

  // What the operator picked was a name; what the draft holds is the id.
  await expect(heldValue(page, 'brandId')).toHaveText('Acme 1');
  await page.getByRole('button', { name: 'Guardar' }).click();

  await expect
    .poll(() => captured.body)
    .toMatchObject({
      name: 'Widget 100',
      brandId: 'product-brand-1',
      categoryId: 'product-category-1',
    });
});

test('picks a brand through the browse dialog', async ({ page, network }) => {
  // The other half of the editor: the target's own table, with its filters and
  // paging, rather than a type-ahead. It exists for "I need to look at the
  // catalog to find it", and it writes the same scalar id.
  const captured = captureCreate(network);
  await openCreateForm(page);

  await page.getByLabel('Nombre').fill('Widget 102');

  await page.getByRole('button', { name: 'Examinar Marca' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // Selection is a per-row button, not a row click: in a picker the row must set
  // the value rather than navigate away from the form it was opened from.
  await dialog
    .getByRole('row')
    .filter({ hasText: 'Globex 1' })
    .first()
    .getByRole('button', { name: 'Seleccionar' })
    .click();

  await expect(heldValue(page, 'brandId')).toHaveText('Globex 1');
  await page.getByRole('button', { name: 'Guardar' }).click();

  await expect
    .poll(() => captured.body)
    .toMatchObject({ brandId: 'product-brand-2' });
});

test('reads stored classifications back as names', async ({ page }) => {
  await page.goto('/catalog/product/product-1');

  // The seeded specification names both by id, and neither lives in the store
  // this page loaded the product from — resolving them is a read through
  // `catalog-reference`'s own service, which is the only legal way across the
  // boundary. This is the round trip a draft restore depends on.
  await expect(heldValue(page, 'brandId')).toHaveText('Acme 1');
  await expect(heldValue(page, 'categoryId')).toHaveText('Acme tools 1');
});

test('omits a classification the user clears', async ({ page, network }) => {
  const captured = captureCreate(network);
  await openCreateForm(page);

  await page.getByLabel('Nombre').fill('Widget 101');
  await pickByName(page, 'Marca', 'Acme 1');
  await page.getByRole('button', { name: 'Quitar Marca' }).click();
  await page.getByRole('button', { name: 'Guardar' }).click();

  // Absent, not `''`. Nothing enforces this reference across the store
  // boundary, so an empty string would be a dangling id rather than "unset".
  await expect.poll(() => captured.body).not.toHaveProperty('brandId');
});
