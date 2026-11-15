// The back office under `next dev`, loaded headless, must load once.
//
// Batch 0 measured 147 loads in 12 seconds against `next dev` (#553), which
// made every live pass run against a production build instead — slower, and
// blind to anything that only breaks under HMR. This is the guard: sign in for
// real through the hosted login, open the home page, and count the `load`
// events the page fires over twelve seconds. Anything but one fails.
//
// It needs the fleet running (`pnpm run back-office:dev`), because a signed-in
// page is what the loop was measured on; it starts nothing itself.
//
//   pnpm nx run @r10c/source:dev-reload-check
//
// BACK_OFFICE_APP_URL overrides the origin (default http://localhost:3001).
import { createRequire } from 'node:module';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
// The e2e project owns the browser tooling; resolving through it keeps this
// script on the same Playwright and session fixture the live suite uses.
const require = createRequire(
  join(ROOT, 'apps/back-office-app-e2e/package.json'),
);
const { chromium } = require('@playwright/test');

process.env['E2E_PROFILE'] = 'live';
const { seedSession } = await import(
  require.resolve('@entifix/testing-e2e/playwright')
);

const ORIGIN = process.env['BACK_OFFICE_APP_URL'] ?? 'http://localhost:3001';
const WINDOW_MS = 12_000;

const browser = await chromium.launch();
try {
  const context = await browser.newContext();
  // Alan, the vendor: the account whose home renders tenant data.
  await seedSession(context, { identifier: 'alan@example.com' });
  const page = await context.newPage();
  let loads = 0;
  page.on('load', () => {
    loads += 1;
  });
  await page.goto(`${ORIGIN}/es/home`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(WINDOW_MS);

  if (loads !== 1) {
    console.error(
      `dev-reload-check: /es/home loaded ${loads} times in ${WINDOW_MS / 1000}s; ` +
        'expected exactly 1. Something watching the app is reloading it — see ' +
        'docs/DEVELOPING.md → "A dev server that reloads itself".',
    );
    process.exitCode = 1;
  } else {
    console.log(
      `dev-reload-check: /es/home loaded once in ${WINDOW_MS / 1000}s.`,
    );
  }
} finally {
  await browser.close();
}
