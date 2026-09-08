import { defineEntifixE2eConfig } from '@r10c/entifix-ts-testing-e2e/playwright';

/**
 * marketplace-app e2e.
 *
 * Everything profile-dependent — which specs are collected, which browsers run,
 * which base URL is used — lives in the shared preset. See
 * `packages/entifix/ts/testing-e2e/README.md`.
 *
 * ⚠️ The one thing this suite cannot take from the preset is how the server is
 * started. The storefront reads marketplace-service from **server components**,
 * so the `page.route()` interception every other suite relies on never sees the
 * traffic — the fetch happens in the Next process, not the browser. The `mock`
 * profile therefore starts that process under a preload that installs msw
 * inside it (`src/support/server-mocks.mjs`).
 *
 * Three things about this command line, each of which a shorter one gets wrong.
 *
 * ⚠️ **`NODE_OPTIONS`, not a bare `--import`.** Next forks render workers, and
 * a flag passed on the parent's command line does not reach them — so some
 * requests are intercepted and some are not, which surfaces as two or three
 * flaky specs rather than as a broken suite. `NODE_OPTIONS` is inherited.
 *
 * ⚠️ **Assigning it also clears what `nx.json` put there.** That file sets
 * `--conditions=@r10c/source` on every `e2e` target, so a spec resolves
 * workspace packages to TypeScript source; inherited by the preload it makes
 * `@r10c/business-ts-catalog-reference` resolve to `src`, where the first
 * `@entity()` decorator is a `SyntaxError: Invalid or unexpected token` —
 * Node strips types, it does not transform them. The server then never starts
 * and not one spec runs. `next start` serves a build that already inlined
 * everything, so it needs that condition for nothing.
 *
 * ⚠️ **`node` on Next's binary, never `pnpm exec`.** `NODE_OPTIONS` reaches
 * pnpm too, and the resolver hook the preload installs runs while pnpm is
 * still loading `.pnpmfile.mjs`, which fails the launch before Next is
 * reached. Both paths are relative to `cwd`, which the preset sets to the
 * app's directory.
 */
export default defineEntifixE2eConfig({
  configFile: __filename,
  appDir: 'apps/marketplace-app',
  port: 3000,
  mockServerCommand:
    "NODE_OPTIONS='--import ../marketplace-app-e2e/src/support/server-mocks.mjs' node ./node_modules/next/dist/bin/next start -p 3000",
});
