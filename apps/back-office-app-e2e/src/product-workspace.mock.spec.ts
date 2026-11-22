import { seedSession } from '@entifix/testing-e2e/playwright';

import {
  expect,
  record,
  STOCK_SERVICE_URL,
  stockItemBackend,
  test,
} from './support/fixtures';
import { stockItemSeed } from './support/stock-seed';

/**
 * One product workspace (#564): an offering's form with its status and verbs,
 * its pictures and its prices from the catalog slice, and its stock from the
 * stock slice — on one page, each region reading and writing through the
 * service that owns it (ADR 0077).
 */
const OFFERING = '/es/catalog/product-offering/product-offering-1';

const region = (page: import('@playwright/test').Page, name: string) =>
  page.getByRole('region', { name });

test.describe('the product workspace', () => {
  // A movement below writes through to the worker's shared stock store, which
  // every later spec in this worker reads. Put the seeded positions back, so
  // a stock list read afterwards still sees 10 on hand, not 15.
  test.afterEach(() => {
    stockItemBackend.seed(stockItemSeed.map(row => ({ ...row })));
  });

  test('shows the offering with its pictures, prices and stock', async ({
    page,
  }) => {
    await page.goto(OFFERING);

    await expect(page.getByLabel('Nombre')).toHaveValue('Taza de cerámica');
    await expect(
      region(page, 'Imágenes').getByRole('img', {
        name: 'Un widget azul sobre fondo blanco',
      }),
    ).toBeVisible();
    await expect(region(page, 'Precios')).toContainText(/(?<!GT)Q\s45\.00/);
    await expect(
      record(region(page, 'Existencias'), 'Taza de cerámica'),
    ).toContainText('10');
    await expect(region(page, 'Movimientos de inventario')).toBeVisible();
  });

  test("lists the pictures in the record's sections, and the link lands on them", async ({
    page,
  }) => {
    await page.goto(OFFERING);

    // The images region is the shell's own, not a related list, and it joins
    // the section nav beside them (#597).
    const sections = page.getByRole('navigation', {
      name: 'Secciones del registro',
    });
    await sections.getByRole('link', { name: 'Imágenes' }).click();
    await expect(region(page, 'Imágenes')).toBeInViewport();
  });

  test('leads to the specification to change its pictures', async ({
    page,
  }) => {
    await page.goto(OFFERING);

    await expect(
      region(page, 'Imágenes').getByRole('link', {
        name: 'Editar especificación',
      }),
    ).toHaveAttribute('href', '/es/catalog/product/product-1');
  });

  test('records a movement for the offering already chosen', async ({
    page,
    network,
  }) => {
    const { http, HttpResponse } = await import('msw');
    // The service applies a movement to the position; the mock does it here.
    network.use(
      http.post(`${STOCK_SERVICE_URL}/stock-movement`, async ({ request }) => {
        const envelope = (await request.json()) as {
          meta: { entity: string };
          data: { offeringId: string; quantity: number };
        };
        stockItemBackend.seed(
          stockItemBackend.rows().map(row =>
            row['offeringId'] === envelope.data.offeringId
              ? {
                  ...row,
                  onHand: Number(row['onHand']) + envelope.data.quantity,
                  available: Number(row['available']) + envelope.data.quantity,
                }
              : row,
          ),
        );
        return HttpResponse.json({
          meta: { type: 'entity', entity: envelope.meta.entity },
          data: { ...envelope.data, id: 'stock-movement-new' },
        });
      }),
    );
    await page.goto(OFFERING);

    const movements = region(page, 'Movimientos de inventario');
    await movements.getByRole('link', { name: /Nuevo|Nueva/ }).click();
    await page.waitForURL(/\/stock\/stock-movement\/new\?/);
    expect(page.url()).toContain('prefill.offeringId=product-offering-1');

    await page.getByLabel('Cantidad').fill('5');
    await page.getByLabel('Motivo').selectOption({ label: 'Recepción' });
    await page.getByRole('button', { name: 'Guardar' }).click();
    await page.waitForURL(/\/stock\/stock-movement$/);

    await page.goto(OFFERING);
    await expect(
      record(region(page, 'Existencias'), 'Taza de cerámica'),
    ).toContainText('15');
  });

  test('leaves the stock out for a reader who may not see it', async ({
    page,
    context,
  }) => {
    await seedSession(context, {
      roles: ['admin'],
      entitlements: ['product-configuration-management'],
    });
    const stockReads: string[] = [];
    page.on('request', request => {
      if (request.url().includes('/stock-item')) stockReads.push(request.url());
    });

    await page.goto(OFFERING);

    await expect(region(page, 'Precios')).toContainText(/(?<!GT)Q\s45\.00/);
    await expect(region(page, 'Existencias')).toHaveCount(0);
    expect(stockReads).toEqual([]);
  });

  test('a specification offers itself, with the specification chosen', async ({
    page,
  }) => {
    await page.goto('/es/catalog/product/product-1');

    const offerings = region(page, 'Ofertas de este producto');
    await expect(record(offerings, 'Taza de cerámica')).toBeVisible();
    await expect(offerings.getByRole('link', { name: /Nuev/ })).toHaveAttribute(
      'href',
      /prefill\.specificationId=product-1/,
    );
  });

  test('opens the same page as a workspace tab', async ({ page }) => {
    await page.goto(
      '/es/workspace?tab=master%3Aproduct-offering%3Aproduct-offering-1',
    );

    await expect(region(page, 'Precios')).toContainText(/(?<!GT)Q\s45\.00/);
    await expect(region(page, 'Existencias')).toBeVisible();
  });
});
