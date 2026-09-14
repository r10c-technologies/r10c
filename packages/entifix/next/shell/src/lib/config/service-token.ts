/**
 * config-service's fleet lookup is gated on a shared token, since it serves real
 * connection strings and the JWT signing key. The literal default keeps local dev
 * zero-config; it is replaced per environment through `CONFIG_SERVICE_TOKEN`.
 *
 * This module is server-only, so the token never reaches the browser.
 *
 * It lives on its own because *two* server routes call the gated endpoint: the
 * `/api/config` fetch and the readiness probe. Readiness reaching it without the
 * header is how an app answers `503` forever while being perfectly healthy.
 */
const DEV_SERVICE_TOKEN = 'dev-config-service-token-change-me';

/** Header config-service reads the shared fleet token from. */
export const SERVICE_TOKEN_HEADER = 'x-service-token';

/** Read on each call so a test (or a rotated deployment) can change it. */
export const serviceToken = (): string =>
  process.env.CONFIG_SERVICE_TOKEN ?? DEV_SERVICE_TOKEN;
