import {
  AUTH_TOKEN_AUDIENCE,
  AUTH_TOKEN_ISSUER,
} from '@r10c/business-ts-authn';
import type { Role } from '@r10c/business-ts-authz';
import { signAccessToken } from '@r10c/entifix-ts-jwt-client';
// From the package root, not `/playwright`: that subpath pulls in Playwright,
// which has no business loading inside a vitest service suite.
import { isMockProfile } from '@r10c/entifix-ts-testing-e2e';

import { MOCK_JWT_SECRET } from './mock-service';

/**
 * The HS256 secret to sign spec tokens with.
 *
 * `mock` knows it because the suite composes the service itself. `live` reads
 * it from the environment, defaulting to the value config-service seeds for
 * local development — a live run against a real deployment must pass its own.
 */
const secret = (): string =>
  isMockProfile()
    ? MOCK_JWT_SECRET
    : (process.env['JWT_SECRET'] ??
      'dev-jwt-secret-change-me-at-least-32-chars');

/** A valid access token for a principal carrying `roles`. */
export const signTokenFor = (
  roles: readonly Role[],
  userId = 'user-1',
): Promise<string> =>
  signAccessToken(
    { userId, subject: userId, sessionId: 'sess-1', roles },
    {
      secret: secret(),
      issuer: AUTH_TOKEN_ISSUER,
      audience: AUTH_TOKEN_AUDIENCE,
    },
    900,
  );

/** `Authorization` header value for a principal carrying `roles`. */
export const bearerFor = async (roles: readonly Role[]): Promise<string> =>
  `Bearer ${await signTokenFor(roles)}`;
