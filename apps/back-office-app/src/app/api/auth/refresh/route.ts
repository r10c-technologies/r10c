import { AUTH_SERVICE_URL } from '@r10c/shells-next-auth/server';
import { createRefreshRoute } from '@r10c/shells-next-common/server';

/**
 * `POST /api/auth/refresh` — mint a fresh access token from the session cookie.
 * The handler is shared; this host mounts its own because cookies are
 * per-origin, and it names `AUTH_SERVICE_URL` explicitly now that the auth
 * shell owns that constant.
 */
export const POST = createRefreshRoute({ authServiceUrl: AUTH_SERVICE_URL });
