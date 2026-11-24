// Screenshots of both apps at Batch 0's viewports (390, the Pixel 7, and
// 1280), and the back office's numbers from #566: cells that show a raw id,
// lists that are cards at 1280, and how often a headless page load reloads.
// Run it against production builds (b0-21): `next dev` reloads itself under a
// headless browser and every number would be the dev server's.
//
//   node tools/ux-capture/src/capture.mjs   # into tools/ux-capture/out/
//
// The back office is read signed in as Alan, the hardware store's vendor,
// through the real hosted login (`seedSession` in entifix's live profile), so
// it needs the lab's Zitadel up. `out/` is not committed.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { seedSession } from '@entifix/testing-e2e/playwright';
import { chromium, devices } from 'playwright';

const OUT = new URL('../out/', import.meta.url).pathname;
const STATE = join(OUT, 'back-office-state.json');
const STOREFRONT = process.env.STOREFRONT_URL ?? 'http://localhost:3000';
const BACK_OFFICE = process.env.BACK_OFFICE_URL ?? 'http://localhost:3001';
const SIGN_IN = process.env.BACK_OFFICE_SIGN_IN_URL ?? 'http://localhost:3001';

const STOREFRONT_PATHS = [
  ['home', '/es'],
  ['search', '/es/search?q=a'],
  ['cart', '/es/cart'],
  ['find', '/es/order/find'],
];

/** The back-office lists Batch 0 measured, and the two it said must be tables. */
const BACK_OFFICE_PATHS = [
  ['home', '/es/home'],
  ['offerings', '/es/catalog/product-offering'],
  ['stock', '/es/stock/stock-item'],
  ['orders', '/es/order/product-order', 'table'],
  ['shipments', '/es/fulfilment/shipping-order', 'table'],
  ['commission', '/es/settlement/commission-entry'],
  ['payouts', '/es/settlement/vendor-payout'],
  ['till', '/es/sales/counter-sale'],
  ['configuration', '/es/system/configuration'],
];

/** A UUID, or an `<entity>-N` id, where a person should read a name (#552). */
const RAW_ID =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\b(?:product-offering|product-specification|product-order|stock-item|shipping-order|commission-entry|vendor-payout|settlement-run)-\d+\b/;

const VIEWPORTS = [
  ['390', devices['Pixel 7']],
  ['1280', { viewport: { width: 1280, height: 800 } }],
];

mkdirSync(OUT, { recursive: true });

/** Signs in once, as a vendor reads the back office, and keeps the session. */
const signIn = async browser => {
  process.env['E2E_PROFILE'] = 'live';
  // Signed in on the origin the provider redirects to: a cookie is scoped
  // to the host and not the port, so a production build started on another
  // port reads the same session.
  const context = await browser.newContext({ baseURL: SIGN_IN });
  await seedSession(context, {
    identifier: process.env['UX_IDENTIFIER'] ?? 'alan@example.com',
    password: process.env['UX_PASSWORD'] ?? 'Password123!',
    signInAppUrl: SIGN_IN,
  });
  await context.storageState({ path: STATE });
  await context.close();
};

/** A fresh tab per screen: a list rewrites its URL after it loads. */
const shoot = async (browser, base, name, path, options) => {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded' });
  await page.locator('main').first().waitFor();
  await page.waitForLoadState('networkidle').catch(() => undefined);
  return { context, page };
};

const browser = await chromium.launch();
let failed = false;
try {
  for (const [width, device] of VIEWPORTS) {
    for (const [name, path] of STOREFRONT_PATHS) {
      const { context, page } = await shoot(browser, STOREFRONT, name, path, {
        ...device,
      });
      await page.screenshot({
        path: join(OUT, `sf-${name}-${width}.png`),
        fullPage: true,
      });
      await context.close();
    }
  }

  {
    await signIn(browser);
    const rawIdCells = [];
    for (const [width, device] of VIEWPORTS) {
      for (const [name, path, must] of BACK_OFFICE_PATHS) {
        const { context, page } = await shoot(browser, BACK_OFFICE, name, path, {
          ...device,
          storageState: STATE,
        });
        await page.screenshot({
          path: join(OUT, `bo-${name}-${width}.png`),
          fullPage: true,
        });
        const cells = await page
          .locator('main td, main [role="cell"], main dd')
          .allInnerTexts();
        for (const cell of cells) {
          if (RAW_ID.test(cell)) rawIdCells.push(`${name}@${width}: ${cell.trim()}`);
        }
        if (width === '1280' && must === 'table') {
          const tables = await page.locator('main table').count();
          const ok = tables > 0;
          failed ||= !ok;
          console.log(`${ok ? '✓' : '✗'} ${name} at 1280 is a table`);
        }
        await context.close();
      }
    }
    const ok = rawIdCells.length === 0;
    failed ||= !ok;
    console.log(
      `${ok ? '✓' : '✗'} back-office cells showing a raw id: ${String(rawIdCells.length)} (rule 0)`,
    );
    for (const cell of rawIdCells) console.log(`    ${cell}`);

    // b0-21: how many times one headless page load loads in 12 seconds.
    const context = await browser.newContext({ storageState: STATE });
    const page = await context.newPage();
    let loads = 0;
    page.on('load', () => {
      loads += 1;
    });
    await page.goto(`${BACK_OFFICE}/es/home`);
    await page.waitForTimeout(12_000);
    await context.close();
    const quiet = loads === 1;
    failed ||= !quiet;
    console.log(
      `${quiet ? '✓' : '✗'} back-office loads per headless page load in 12s: ${String(loads)} (rule 1)`,
    );
  }
  console.log(`Screenshots in ${OUT}`);
} finally {
  await browser.close();
}
process.exitCode = failed ? 1 : 0;
