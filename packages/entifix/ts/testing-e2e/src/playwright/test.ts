import { defineNetworkFixture, type NetworkFixture } from '@msw/playwright';
import { test as base } from '@playwright/test';
import type { AnyHandler } from 'msw';

import { isMockProfile } from '../profile/profile';
import { assertExpectedServerOnce } from './assert-expected-server';

export interface EntifixE2eFixtures {
  /** The handlers the mock profile starts from. Overridable per project. */
  handlers: AnyHandler[];
  /** The msw network, for per-test overrides in a `*.mock.spec.ts`. */
  network: NetworkFixture;
  /** Refuses a hermetic run against a reused development server. */
  expectedServer: void;
}

export interface EntifixE2eTestOptions {
  /**
   * The mock backend. Ignored in the `live` profile, where the app talks to a
   * real service.
   */
  handlers?: AnyHandler[];
  /**
   * Origins whose unstubbed requests are allowed through — in practice the app
   * under test itself, which serves its own documents, RSC payloads and
   * dev-tooling endpoints.
   *
   * Everything else must be stubbed: a request to a *service* that nobody
   * handled fails the test rather than escaping to a machine that may not even
   * be running.
   */
  passthroughOrigins?: string[];
}

/**
 * In `live`, the network is untouched — so reaching for it is a mistake worth
 * reporting rather than a silent no-op that makes a spec assert nothing.
 */
const liveNetwork = (): NetworkFixture =>
  new Proxy({} as NetworkFixture, {
    get(_target, property) {
      throw new Error(
        `The network fixture is not available in the live profile (tried to use "${String(property)}"). Move this expectation into a *.mock.spec.ts file.`,
      );
    },
  });

/**
 * Playwright's own `test`, plus the reused-server guard and nothing else.
 *
 * For a spec that wants no msw network and no seeded session — proving the
 * unauthenticated redirect, say. It exists so that "this spec needs no
 * fixtures" cannot quietly mean "this spec is not checked against the artifact
 * it is running on": importing `test` straight from `@playwright/test` is what
 * left the account journeys resolving a principal against a live auth-service
 * while claiming to be hermetic.
 */
export const baseTest = base.extend<Pick<EntifixE2eFixtures, 'expectedServer'>>(
  {
    expectedServer: [
      async ({ baseURL }, use) => {
        await assertExpectedServerOnce(baseURL);
        await use();
      },
      { auto: true },
    ],
  },
);

/**
 * Builds the `test` an entifix app e2e project imports.
 *
 * In `mock` it installs the msw handlers over Playwright's `page.route()`
 * (via `@msw/playwright`), so the browser talks to the fixture backend and the
 * app itself is untouched — no worker script, no `NEXT_PUBLIC_*` switch, no
 * mocking code shipped in the application bundle. In `live` the fixture stands
 * down and the same specs hit the real service.
 */
export const defineEntifixE2eTest = ({
  handlers = [],
  passthroughOrigins = [],
}: EntifixE2eTestOptions = {}) =>
  baseTest.extend<EntifixE2eFixtures>({
    handlers: [handlers, { option: true }],

    network: [
      async ({ context, handlers: activeHandlers }, use) => {
        if (!isMockProfile()) {
          await use(liveNetwork());
          return;
        }

        const network = defineNetworkFixture({
          context,
          handlers: activeHandlers,
          // An unstubbed *service* request must fail the test rather than
          // escape to the network: a spec that passes because it silently
          // talked to nothing is worse than one that fails. The app's own
          // origin is exempt — it legitimately serves itself.
          onUnhandledRequest: (request, print) => {
            if (
              passthroughOrigins.some(origin => request.url.startsWith(origin))
            ) {
              return;
            }
            print.error();
          },
        });

        await network.enable();
        await use(network);
        await network.disable();
      },
      { auto: true },
    ],
  });

export type { NetworkFixture } from '@msw/playwright';
export { expect } from '@playwright/test';
