import { createRefreshRoute } from '@r10c/shells-next-common/server';

/**
 * `POST /api/auth/refresh` — mint a fresh access token from the session cookie.
 * The handler is shared; each app mounts its own because cookies are per-origin
 * and in production this app is not the same host as auth-app.
 */
export const POST = createRefreshRoute();
