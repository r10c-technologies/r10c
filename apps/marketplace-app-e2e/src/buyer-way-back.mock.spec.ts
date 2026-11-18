import type { Browser, Page } from '@playwright/test';

import { fillDelivery } from './support/delivery';
import { expect, scriptStream, test } from './support/stream-fixture';

/**
 * The buyer's way back to an order (ADR 0076 §6): a mailed one-time link that
 * opens the receipt in another browser, and "find my order", which mails a new
 * one. Both are plain forms. "Find my order" is walked with scripting
 * **off**: it reads nothing from the request, so it is wholly prerendered.
 * The access page reads its token from the query, which partial prerendering
 * streams in — and a streamed part stays hidden without script (#725) — so
 * its journey runs with script on.
 *
 * order-service is stubbed in the Next process (`support/server-mocks.mjs`):
 * a token here is `e2e-token-<flowId>`, standing in for the one the mail
 * would carry.
 */

const STATUS_PAGE = /\/es\/order\/status\/(e2e-flow-[^/?]+)/;

/** A completed checkout in `page`, answering its flow id. */
const checkedOut = async (
  page: Page,
  network: Parameters<typeof scriptStream>[0],
) => {
  const script = scriptStream(network);
  await page.goto('/es/p/offering-aurora-desk-lamp');
  await page
    .getByRole('form', { name: 'Comprar' })
    .getByRole('button', { name: 'Añadir al carrito' })
    .click();
  await page.waitForURL(/\/es\/cart(\?|$)/);
  await page.getByTestId('review').filter({ visible: true }).click();
  await page.waitForURL(/\/es\/cart\/review/);
  await fillDelivery(page);
  await page.getByTestId('checkout').filter({ visible: true }).click();
  await page.waitForURL(STATUS_PAGE);
  script.outcome = 'flow.completed';
  await expect(page.getByTestId('order-id')).toBeVisible();
  return STATUS_PAGE.exec(page.url())?.[1] ?? '';
};

/** A second browser — the one a mail link opens — with script on or off. */
const another = async (
  browser: Browser,
  baseURL: string | undefined,
  javaScriptEnabled = true,
) =>
  (
    await browser.newContext({
      javaScriptEnabled,
      ...(baseURL === undefined ? {} : { baseURL }),
    })
  ).newPage();

test.describe('the buyer’s way back', () => {
  test('a mailed link opens the receipt elsewhere, once, and the first browser says so', async ({
    page,
    network,
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000);
    const flowId = await checkedOut(page, network);
    const other = await another(browser, baseURL);

    // Opening the link spends nothing: only the button's post redeems it.
    await other.goto(`/es/order/access?token=e2e-token-${flowId}`);
    await expect(
      other.getByTestId('access-form').filter({ visible: true }),
    ).toBeVisible();
    await other.reload();
    await other.getByRole('button', { name: 'Abrir mi pedido' }).click();
    await other.waitForURL(STATUS_PAGE);
    await expect(other.getByTestId('order-id')).toBeVisible();

    await page.reload();
    await expect(page.getByTestId('receipt-moved').filter({ visible: true })).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Encontrar mi pedido' }).first(),
    ).toBeVisible();

    // Spent: a second redemption is refused, and the page offers the lookup.
    const third = await another(browser, baseURL);
    await third.goto(`/es/order/access?token=e2e-token-${flowId}`);
    await third.getByRole('button', { name: 'Abrir mi pedido' }).click();
    await expect(third.getByTestId('access-refused').filter({ visible: true })).toBeVisible();
  });

  test('a link with no token says it is incomplete', async ({ page }) => {
    await page.goto('/es/order/access');
    await expect(page.getByTestId('access-refused').filter({ visible: true })).toContainText(
      'incompleto',
    );
  });

  test('find my order works without script, and says the same whatever matched', async ({
    browser,
    baseURL,
  }) => {
    const page = await another(browser, baseURL, false);
    await page.goto('/es');
    await page.getByTestId('footer-find-order').click();
    await page.waitForURL(/\/es\/order\/find$/);

    await page.getByLabel('Número de pedido').fill('ZZZZ-ZZZZ');
    await page.getByLabel('Correo electrónico').fill('nadie@ejemplo.com');
    await page.getByRole('button', { name: 'Enviarme un enlace' }).click();

    await page.waitForURL(/\/es\/order\/find\/sent$/);
    await expect(page.getByTestId('find-sent').filter({ visible: true })).toContainText(
      'Si los datos coinciden',
    );
  });
});
