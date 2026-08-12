import type { Page } from '@playwright/test';
import type { NetworkFixture } from '@r10c/entifix-ts-testing-e2e/playwright';
import { http, HttpResponse } from 'msw';

import { expect, PRODUCT_URL, test } from './support/fixtures';

/**
 * Setting a specification's brand and category, and what that puts on the wire.
 *
 * This file used to exercise two relation **pickers** — a quick type-ahead and a
 * browse dialog — and assert that `brand` left embedded while `category` left as
 * a bare key, because the entity declared those two wire shapes.
 *
 * Neither holds now. Both targets moved to `catalog-reference`, a platform-plane
 * store owned by another slice, so `ProductSpecification` carries plain
 * `brandId` / `categoryId` strings and the form renders them as ordinary inputs
 * ([ADR 0022](../../../docs/adr/0022-v1-marketplace-module-boundaries.md)).
 * What is still worth asserting end to end is the payload: the ids must reach
 * the service as scalars, and an emptied field must arrive as *absent* rather
 * than as an empty string.
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

test('sends both classifications as scalar ids', async ({ page, network }) => {
  const captured = captureCreate(network);
  await openCreateForm(page);

  await page.getByLabel('Código').fill('P-100');
  await page.getByLabel('Nombre').fill('Widget 100');
  await page.getByRole('textbox', { name: 'Marca' }).fill('product-brand-1');
  await page
    .getByRole('textbox', { name: 'Categoría' })
    .fill('product-category-1');
  await page.getByRole('button', { name: 'Guardar' }).click();

  await expect
    .poll(() => captured.body)
    .toMatchObject({
      code: 'P-100',
      brandId: 'product-brand-1',
      categoryId: 'product-category-1',
    });
});

test('reads stored classifications back into their fields', async ({
  page,
}) => {
  await page.goto('/catalog/product/product-1');

  // The seeded specification names both, so a reload must repopulate both —
  // this is the round trip a draft restore depends on.
  await expect(page.getByRole('textbox', { name: 'Marca' })).toHaveValue(
    'product-brand-1',
  );
  await expect(page.getByRole('textbox', { name: 'Categoría' })).toHaveValue(
    'product-category-1',
  );
});

test('omits a classification the user clears', async ({ page, network }) => {
  const captured = captureCreate(network);
  await openCreateForm(page);

  await page.getByLabel('Código').fill('P-101');
  await page.getByLabel('Nombre').fill('Widget 101');
  await page.getByRole('textbox', { name: 'Marca' }).fill('product-brand-1');
  await page.getByRole('textbox', { name: 'Marca' }).clear();
  await page.getByRole('button', { name: 'Guardar' }).click();

  // Absent, not `''`. Nothing enforces this reference across the store
  // boundary, so an empty string would be a dangling id rather than "unset".
  await expect.poll(() => captured.body).not.toHaveProperty('brandId');
});
