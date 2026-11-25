import type { Page } from '@playwright/test';
import { http, HttpResponse } from 'msw';

import {
  CATALOG_IMPORT_VERB_URL,
  expect,
  record,
  test,
} from './support/fixtures';

/**
 * A catalog loaded from a sheet
 * ([ADR 0084](../../../docs/adr/0084-a-catalog-import-is-a-record-and-a-row-is-one-unit-of-work.md)).
 *
 * What only a browser proves: the sheet is parsed **here** and never
 * uploaded, a refused row is named before anything is sent, the request
 * carries the rows and an `Idempotency-Key`, and the operator lands on the
 * import's own record.
 *
 * Mock-only, for `wizard-product-setup`'s reason: observing the request body
 * means choosing the response. The live half is
 * `apps/fleet-e2e/src/catalog/catalog-import.live.spec.ts`.
 */

const WIZARD = '/es/wizards/import-catalog';

const SHEET = [
  'Nombre;Precio;Marca;Unidad;Paso',
  'Tornillo 1/4";1,50;Acme 1;UN;',
  'Cuero vaqueta;120;Nadie;M;0,5',
  'Clavo;gratis;;;',
].join('\n');

const choose = async (page: Page, sheet: string, name = 'catalogo.csv') => {
  await page.getByLabel('Hoja del catálogo').setInputFiles({
    name,
    mimeType: 'text/csv',
    buffer: Buffer.from(sheet, 'utf8'),
  });
};

test('reads the sheet in the browser and names every refused row', async ({
  page,
}) => {
  await page.goto(WIZARD);
  await page.getByRole('button', { name: /Como borradores/ }).click();
  await page.getByTestId('wizard-next').click();

  await choose(page, SHEET);
  await expect(page.getByTestId('catalog-import-read')).toHaveText(
    'catalogo.csv: 1 filas listas, 2 con problemas.',
  );
  await page.getByTestId('wizard-next').click();

  await expect(page.getByTestId('catalog-import-ready')).toHaveText(
    'Filas que se importarán: 1',
  );
  const rows = page.getByRole('table').getByRole('row');
  await expect(rows.nth(1)).toContainText('Marca');
  await expect(rows.nth(1)).toContainText('no coincide con ninguno');
  await expect(rows.nth(2)).toContainText('Precio');
});

test('submits the rows under one key and lands on the import', async ({
  page,
  network,
}) => {
  const sent: { key?: string | null; body?: unknown } = {};
  network.use(
    http.post(CATALOG_IMPORT_VERB_URL, async ({ request }) => {
      sent.key = request.headers.get('idempotency-key');
      sent.body = await request.json();
      return HttpResponse.json({
        meta: { type: 'entity', entity: 'catalog-import' },
        data: {
          id: 'catalog-import-1',
          fileName: 'catalogo.csv',
          mode: 'publish',
          status: 'completed',
          rowCount: 1,
          createdCount: 1,
          rejectedCount: 0,
        },
      });
    }),
  );

  await page.goto(WIZARD);
  await page.getByRole('button', { name: /Publicados/ }).click();
  await page.getByTestId('wizard-next').click();
  await choose(page, 'Nombre,Precio\nTornillo,"1,50"\n');
  await page.getByTestId('wizard-next').click();
  await page.getByRole('button', { name: 'Finalizar' }).click();

  await expect(page).toHaveURL(/\/catalog\/catalog-import\/catalog-import-1$/);
  expect(sent.key).toMatch(/^"[0-9a-f-]{36}"$/);
  expect(sent.body).toEqual({
    fileName: 'catalogo.csv',
    mode: 'publish',
    rows: [
      {
        rowNumber: 2,
        name: 'Tornillo',
        amount: 150,
        currency: 'GTQ',
        pricePer: 1,
        saleUnit: 'UN',
        quantityStep: 1,
        quantityMinimum: 1,
      },
    ],
  });
});

test('lists what each import did, and offers no way to write one', async ({
  page,
}) => {
  await page.goto('/es/catalog/catalog-import');

  await expect(record(page, 'catalogo-ferreteria.csv')).toBeVisible();
  await expect(
    page.getByRole('main').getByRole('link', { name: 'Importar catálogo' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /^Nuevo|^Nueva/ })).toHaveCount(
    0,
  );

  await page.goto('/es/catalog/catalog-import/catalog-import-1');
  await expect(page.getByText('catalogo-ferreteria.csv').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guardar' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Eliminar' })).toHaveCount(0);
});
