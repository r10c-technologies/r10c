import { defineEntifixTest } from '../../../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@r10c/entifix-ts-testing-e2e',
  root: __dirname,
  coverageExclude: [
    // The Playwright entry point: a config preset, a `test.extend` fixture and
    // a page object. Every line of it only executes inside a Playwright worker
    // driving a browser, so it cannot be reached from the vitest gate — and
    // faking a `Page` to reach it would assert nothing about the browser
    // behaviour it exists for. It is exercised by the app e2e suites instead,
    // in BOTH profiles.
    'src/playwright/**',
  ],
});
