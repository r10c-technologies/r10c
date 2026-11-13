// The measurements run in the page, so this file is checked against the DOM's
// types as well.
/// <reference lib="dom" />
import type { Locator, Page } from '@playwright/test';

import { expect, scriptStream, test } from './support/stream-fixture';

/**
 * The storefront at 320 CSS pixels (WCAG 1.4.10, #529): no screen scrolls
 * sideways, what a buyer came for starts on the first screen, and the primary
 * touch targets hit at the 44px floor r10c ADR 0075 sets for them.
 *
 * 320×640 is the reflow criterion's own width, at the height of a small phone,
 * so "above the fold" is a number rather than a judgement.
 */
const FOLD = 640;
const TOUCH_FLOOR = 44;

test.use({ viewport: { width: 320, height: FOLD } });

const expectNoSidewaysScroll = async (page: Page) => {
  const { scroll, client } = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(scroll, 'the page scrolls sideways').toBeLessThanOrEqual(client);
};

const expectAboveTheFold = async (target: Locator) => {
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box, 'no box to measure').not.toBeNull();
  expect(box?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(FOLD);
};

const expectTouchTarget = async (target: Locator) => {
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(TOUCH_FLOOR);
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(TOUCH_FLOOR);
};

test('the storefront reflows at 320px and keeps commerce above the fold', async ({
  page,
  network,
}) => {
  test.setTimeout(120_000);
  const script = scriptStream(network);

  await test.step('home', async () => {
    await page.goto('/es');
    await expectAboveTheFold(page.getByRole('article').first());
    await expectNoSidewaysScroll(page);
    await expectTouchTarget(page.getByTestId('cart-badge'));
  });

  await test.step('category', async () => {
    await page.goto('/es/c/lighting');
    await expectAboveTheFold(page.getByRole('article').first());
    await expectNoSidewaysScroll(page);
  });

  const buy = page.getByRole('form', { name: 'Comprar' });

  await test.step('product', async () => {
    await page.goto('/es/p/offering-aurora-desk-lamp');
    const add = buy.getByRole('button', { name: 'Añadir al carrito' });
    await expectAboveTheFold(add);
    await expectNoSidewaysScroll(page);
    await expectTouchTarget(add);
    await expectTouchTarget(buy.getByRole('spinbutton'));
  });

  await test.step('cart', async () => {
    await buy.getByRole('button', { name: 'Añadir al carrito' }).click();
    await page.waitForURL(/\/es\/cart(\?|$)/);
    await expectNoSidewaysScroll(page);
    await expectTouchTarget(page.getByTestId('checkout'));
    await expectTouchTarget(page.getByRole('spinbutton').first());
  });

  await test.step('receipt', async () => {
    await page.getByTestId('checkout').click();
    await page.waitForURL(/\/es\/order\/status\/e2e-flow-/);
    script.outcome = 'flow.completed';
    await expect(page.getByTestId('order-id')).toBeVisible();
    await expectNoSidewaysScroll(page);
  });

  await test.step('not-found', async () => {
    await page.goto('/es/p/no-such-offering');
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(
      page.getByRole('link', { name: 'Buscar en la tienda' }),
    ).toHaveAttribute('href', '/es/search');
    await expectNoSidewaysScroll(page);
  });
});
