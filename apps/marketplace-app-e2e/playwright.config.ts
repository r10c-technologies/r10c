import { join } from 'node:path';

import {
  defineEntifixE2eConfig,
  resolveE2eProfile,
} from '@entifix/testing-e2e/playwright';
import { workspaceRoot } from '@nx/devkit';

/**
 * ⚠️ Absolute, because `NODE_OPTIONS` is inherited by **every** node process
 * the run spawns, and they do not share a working directory: a relative
 * `--import` resolves against whichever cwd each one happens to have, and the
 * ones nx starts from the workspace root then die with `ERR_MODULE_NOT_FOUND`.
 */
const PRELOAD = join(__dirname, 'src/support/server-mocks.mjs');

/**
 * marketplace-app e2e.
 *
 * Everything profile-dependent — which specs are collected, which browsers run,
 * which base URL is used — lives in the shared preset. See
 * the `@entifix/testing-e2e` README.
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
 * reached. The Next binary is still relative to `cwd`, which the preset sets
 * to the app's directory; the preload is not — see `PRELOAD` above.
 */
const MOCK_SERVER = `NODE_OPTIONS='--import ${PRELOAD}' node ./node_modules/next/dist/bin/next start -p 3200`;

/**
 * ⚠️ **Two servers, replacing the preset's one.** The browser reaches the
 * storefront through the edge on :3000, and Next listens behind it on :3200
 * (ADR 0072), so the preset's single `next start -p 3000` would bind the port
 * the edge owns. The edge is probed through to Next, so "ready" means the whole
 * path answers rather than just Envoy's socket. `mockServerCommand` is
 * therefore passed here rather than to the preset, which only reads it for the
 * server it builds itself.
 */
/**
 * ⚠️ **The fixtures' pictures are never fetched.** The catalog fixtures name
 * their media on `picsum.photos`, as a vendor names a real host, and the
 * storefront renders them as plain `<img>`s — so the browser, not Next, fetches
 * them, and `page.goto` waits for every one before `load`. When that host
 * stalls, every product page times out and the suite fails on someone else's
 * network. Chromium is told the name does not resolve, so each picture errors
 * at once and `load` fires; a spec asserts the reference a page renders, never
 * the pixels. The flag is Chromium's, so it goes on that project only, and the
 * preset's config is extended rather than overridden — `overrides` merges
 * shallowly, and a `use` passed there would drop the preset's `baseURL`.
 */
const UNRESOLVED_MEDIA_HOSTS = ['picsum.photos'];

const config = defineEntifixE2eConfig({
  configFile: __filename,
  appDir: 'apps/marketplace-app',
  port: 3000,
  overrides: {
    webServer: [
      {
        command:
          resolveE2eProfile() === 'mock'
            ? MOCK_SERVER
            : 'pnpm exec next start -p 3200',
        cwd: join(workspaceRoot, 'apps/marketplace-app'),
        url: 'http://localhost:3200',
        reuseExistingServer: true,
      },
      {
        command: 'bash tools/edge/serve.sh',
        cwd: workspaceRoot,
        url: 'http://localhost:3000',
        reuseExistingServer: true,
      },
    ],
  },
});

export default {
  ...config,
  projects: config.projects?.map(project =>
    project.name === 'chromium'
      ? {
          ...project,
          use: {
            ...project.use,
            launchOptions: {
              ...project.use?.launchOptions,
              args: [
                ...(project.use?.launchOptions?.args ?? []),
                `--host-resolver-rules=${UNRESOLVED_MEDIA_HOSTS.map(host => `MAP ${host} ~NOTFOUND`).join(', ')}`,
              ],
            },
          },
        }
      : project,
  ),
};
