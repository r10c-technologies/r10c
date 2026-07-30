import { createConfigRoute } from '@r10c/shells-next-common/server';

/**
 * This app's centralized configuration, fetched server-side from config-service
 * and returned as `ConfigurationPlain`.
 *
 * No proxy rewrites: auth-app reaches auth-service through its own hand-written
 * per-endpoint route handlers (they set and clear session cookies, so they cannot
 * be a generic pipe), and no browser adapter uses `auth-service-domain`.
 */
export const GET = createConfigRoute({ service: 'auth-app' });
