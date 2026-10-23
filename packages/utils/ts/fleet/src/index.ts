/**
 * The fleet's own protocol with config-service: where it answers, the header a
 * caller presents and where that header's secret comes from.
 *
 * These were entifix's until 0.5.0, which made them values a host passes
 * (`loadRemoteConfiguration({ url, headers })`, `requireSharedToken`,
 * `ConfigurationSource`). They are r10c's conventions, so they live here once
 * and every Effect service and Next host reads the same ones — the header and
 * the token cannot drift apart between the client half and the guard half.
 */

/** The header a caller of config-service's fleet lookup presents. */
export const SERVICE_TOKEN_HEADER = 'x-service-token';

/**
 * Local-dev default, so `pnpm run back-office:dev` stays zero-config. Same
 * convention as the seeded `jwt.secret`: obviously a placeholder, replaced per
 * environment through `CONFIG_SERVICE_TOKEN`.
 */
export const DEV_SERVICE_TOKEN = 'dev-config-service-token-change-me';

/**
 * The fleet token, read from the environment on each call rather than captured
 * at module load — so a test can set it without re-importing the module.
 */
export const serviceToken = (): string =>
  process.env['CONFIG_SERVICE_TOKEN'] ?? DEV_SERVICE_TOKEN;

/** The header and secret together, in the shape entifix's guards take. */
export const fleetToken = {
  header: SERVICE_TOKEN_HEADER,
  token: serviceToken,
} as const;

/** Where config-service answers. `CONFIG_API_URL`, or the local lab's port. */
export const configApiUrl = (): string =>
  (process.env['CONFIG_API_URL'] ?? 'http://localhost:3190').replace(
    /\/+$/,
    '',
  );

/**
 * One service's or app's configuration lookup — `GET /api/config/:key` with
 * the fleet token — as the `{ url, headers }` entifix's loaders and routes take.
 * Read on each call, for the same reason as {@link serviceToken}.
 */
export const configSourceFor = (key: string) => ({
  url: `${configApiUrl()}/api/config/${key}`,
  headers: { [SERVICE_TOKEN_HEADER]: serviceToken() },
});
