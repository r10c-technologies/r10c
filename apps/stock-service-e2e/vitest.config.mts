import { defineEntifixTest } from '../../vitest.shared.mjs';

/**
 * Profile selection is by filename, matching the Playwright preset: a spec that
 * cannot run under the active profile is not collected, rather than skipping
 * itself into a green report.
 *
 * That split carries more weight here than in the other service suites. The
 * `mock` profile's Mongo is a single-threaded object graph, so its
 * `withTransaction` is atomicity without isolation — a parallel burst resolves
 * in the order it was written, and every concurrency assertion passes whatever
 * the code does. `concurrency.live.spec.ts` is therefore live-only by
 * construction, not by preference
 * ([ADR 0010](../../docs/adr/0010-stock-ledger-reservations-and-concurrency.md)).
 *
 * The variable is read directly rather than through
 * `@r10c/entifix-ts-testing-e2e`: Vitest loads this config with Node's native
 * TypeScript stripping, which cannot resolve the package's extensionless
 * internal imports. Validation of the value still happens in the suite, where
 * `defineServiceE2e` rejects anything that is not a known profile.
 */
const mock = (process.env['E2E_PROFILE'] ?? 'mock') === 'mock';

export default defineEntifixTest({
  name: '@r10c/stock-service-e2e',
  root: __dirname,
  thresholds: false,
  exclude: mock ? ['**/*.live.spec.ts'] : ['**/*.mock.spec.ts'],
});
