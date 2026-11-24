// The storefront half of #566's numbers, measured the way Batch 0 measured
// them (2026-11-14): a Pixel 7 profile, 4× CPU slowdown, 1.6 Mbps down and
// 150ms RTT. Run it against a production build (`next build` + `next start`,
// b0-21): a dev server's numbers are the compiler's.
//
//   STOREFRONT_URL=http://localhost:3000 node tools/ux-capture/src/cwv.mjs
//
// It prints LCP, CLS, TTFB and first-load bytes (pictures excluded, as Batch 0
// excluded them) for the home, a category and a product, then walks a
// checkout from the home and counts the taps and the form fields on the way.
import { chromium, devices } from 'playwright';

const BASE = process.env.STOREFRONT_URL ?? 'http://localhost:3000';
const OUT_SHOT = new URL('../out/checkout-walk-failed.png', import.meta.url)
  .pathname;
const RUNS = Number(process.env.CWV_RUNS ?? '3');

/** 1.6 Mbps down, 750 Kbps up, 150ms round trip: Batch 0's network. */
const NETWORK = {
  offline: false,
  latency: 150,
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
};

const RULES = {
  lcp: 0.76,
  cls: 0,
  ttfb: 0.15 * 1.1,
  firstLoadKb: 420,
  taps: 4,
};

const throttled = async context => {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', NETWORK);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  // Observers registered before any script of the page runs, buffered, so
  // nothing painted before they attach is missed.
  await page.addInitScript(() => {
    window.__cwv = { lcp: 0, cls: 0 };
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        window.__cwv.lcp = entry.startTime;
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) window.__cwv.cls += entry.value;
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  return page;
};

/** One cold load of `path`: a fresh context, so nothing is cached. */
const measure = async (browser, path) => {
  const context = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await throttled(context);
  await page.goto(`${BASE}${path}`, { waitUntil: 'load' });
  // LCP settles after load; give it the quiet a field measure would.
  await page.waitForTimeout(1500);
  const result = await page.evaluate(() => {
    const [navigation] = performance.getEntriesByType('navigation');
    const bytes = [navigation, ...performance.getEntriesByType('resource')]
      .filter(
        entry =>
          entry.initiatorType !== 'img' &&
          !/\.(?:avif|webp|png|jpe?g|svg|gif)(?:\?|$)|\/_next\/image\?/.test(
            entry.name,
          ),
      )
      .reduce((sum, entry) => sum + (entry.transferSize ?? 0), 0);
    return {
      lcp: window.__cwv.lcp / 1000,
      cls: window.__cwv.cls,
      ttfb: navigation.responseStart / 1000,
      firstLoadKb: bytes / 1024,
    };
  });
  await context.close();
  return result;
};

/** Where a buyer goes first from the home: its first product and category. */
const discover = async browser => {
  const page = await browser.newPage();
  await page.goto(`${BASE}/es`, { waitUntil: 'domcontentloaded' });
  const product = await page
    .locator('a[href*="/p/"]')
    .first()
    .getAttribute('href');
  const category = await page
    .locator('a[href*="/c/"]')
    .first()
    .getAttribute('href');
  await page.close();
  return [
    ['home', '/es'],
    ...(category ? [['category', new URL(category, BASE).pathname]] : []),
    ...(product ? [['product', new URL(product, BASE).pathname]] : []),
  ];
};

/**
 * The checkout from the home, counted: every click a buyer makes is a tap,
 * and every field they must fill is counted and named. A field is typed into,
 * not tapped — Batch 0 counted the same way.
 */
const walkCheckout = async browser => {
  const context = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await context.newPage();
  let taps = 0;
  const tap = async locator => {
    taps += 1;
    await locator.click();
  };
  await page.goto(`${BASE}/es`, { waitUntil: 'domcontentloaded' });
  await tap(page.locator('a[href*="/p/"]').first());
  await page.waitForURL(/\/p\//);
  await tap(
    page
      .getByRole('form', { name: 'Comprar' })
      .getByRole('button', { name: 'Añadir al carrito' }),
  );
  await page.waitForURL(/\/cart(\?|$)/);
  await tap(page.getByTestId('review').filter({ visible: true }));
  await page.waitForURL(/\/cart\/review/);
  const form = page.getByTestId('delivery-form').filter({ visible: true });
  await form.getByTestId('checkout').waitFor();
  const fields = await form
    .locator('input:not([type=hidden]):not([type=radio]), select, textarea')
    .evaluateAll(nodes =>
      nodes.map(
        node =>
          node.labels?.[0]?.textContent?.trim() ??
          node.getAttribute('name') ??
          '?',
      ),
    );
  // A seller that takes more than one tender asks which at review
  // (ADR 0076 §7) — a choice the delivery milestone added, as it added the
  // fields, so it is counted and named apart from the taps Batch 0 counted.
  const tenders = form.locator('input[type="radio"]');
  const choices = (await tenders.count()) > 0 ? 1 : 0;
  if (choices > 0) await tenders.first().check();
  await form
    .getByLabel('Nombre de quien recibe', { exact: true })
    .fill('Ana López');
  await form.getByLabel('Teléfono', { exact: true }).fill('5555-1234');
  await form
    .getByLabel('Correo electrónico', { exact: true })
    .fill('ana@correo.com');
  await form.getByLabel('Municipio', { exact: true }).selectOption('0108');
  await form.getByLabel('Dirección', { exact: true }).fill('5a avenida 12-34');
  await tap(form.getByTestId('checkout'));
  await page
    .waitForURL(/\/order\/status\//, { timeout: 30_000 })
    .catch(async error => {
      await page.screenshot({ path: OUT_SHOT, fullPage: true });
      const alerts = await page.getByRole('alert').allInnerTexts();
      throw new Error(
        `the checkout did not reach its receipt; alerts: ${alerts.join(' | ')}; page in ${OUT_SHOT}`,
        { cause: error },
      );
    });
  await context.close();
  return { taps, fields, choices };
};

const median = values =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

const browser = await chromium.launch();
let failed = false;
const verdict = (label, value, limit, unit = '') => {
  // Judged at the precision it is reported in, as Batch 0 reported it: a
  // layout shift of 0.0001 is the 0.000 the rule names.
  const ok = Number(value.toFixed(3)) <= limit;
  failed ||= !ok;
  console.log(
    `${ok ? '✓' : '✗'} ${label}: ${value.toFixed(3)}${unit} (rule ≤ ${limit.toFixed(3)}${unit})`,
  );
};

try {
  for (const [name, path] of await discover(browser)) {
    const runs = [];
    for (let run = 0; run < RUNS; run += 1) {
      runs.push(await measure(browser, path));
    }
    console.log(`${name} ${path} — median of ${String(RUNS)}`);
    verdict('  LCP', median(runs.map(r => r.lcp)), RULES.lcp, 's');
    verdict('  CLS', median(runs.map(r => r.cls)), RULES.cls);
    verdict('  TTFB', median(runs.map(r => r.ttfb)), RULES.ttfb, 's');
    verdict(
      '  first load',
      median(runs.map(r => r.firstLoadKb)),
      RULES.firstLoadKb,
      'KB',
    );
  }
  const { taps, fields, choices } = await walkCheckout(browser);
  verdict('checkout taps, home → placed', taps, RULES.taps);
  console.log(
    `checkout choices at review: ${String(choices)} (how to pay a seller who takes more than one tender, ADR 0076 §7)`,
  );
  console.log(`checkout form fields: ${String(fields.length)} — ${fields.join(', ')}`);
} finally {
  await browser.close();
}
process.exitCode = failed ? 1 : 0;
