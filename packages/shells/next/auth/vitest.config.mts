import { defineEntifixTest } from '../../../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@r10c/shells-next-auth',
  root: __dirname,
  environment: 'jsdom',
  // These files moved here from `apps/auth-app`, where the 100% gate does not
  // apply because an app is covered by its `*-e2e` project instead. Moving a
  // file must not silently change what covers it, so the exclusions below name
  // exactly the surface `back-office-app-e2e` drives — and nothing else. Everything
  // with a decision in it (the redirect allowlist, the permission-annotated
  // nav) stays gated, which is the half worth unit-testing anyway.
  coverageExclude: [
    // React pages and views: rendered end-to-end by the Playwright specs.
    'src/client/**',
    'src/server/account-page.tsx',
    // Cookie plumbing and same-origin proxies. Every one is `fetch` upstream
    // and hand the answer back; a unit test here asserts that `fetch` was
    // called, which is a restatement of the source rather than a check on it.
    'src/server/session.ts',
    'src/server/principal.ts',
    'src/server/routes.ts',
  ],
});
