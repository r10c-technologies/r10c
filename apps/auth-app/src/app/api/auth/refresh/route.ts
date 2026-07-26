import { createRefreshRoute } from '@r10c/shells-next-common/server';

import { AUTH_SERVICE_URL } from '../../../../lib/session';

/**
 * `POST /api/auth/refresh` — mint a fresh access token from the session cookie.
 * The handler is shared; each app mounts its own because cookies are per-origin.
 */
export const POST = createRefreshRoute({ authServiceUrl: AUTH_SERVICE_URL });
