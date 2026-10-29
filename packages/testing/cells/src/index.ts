import type { TokenClaims } from '@entifix/business';
import { formatIdempotencyKey, IDEMPOTENCY_KEY_HEADER } from '@entifix/core';
import {
  CROSSING_TOKEN_HEADER,
  ORGANIZATION_HEADER,
} from '@entifix/service-shell';
import type { ServedRoutes } from '@r10c/testing-http';

/**
 * Helpers the cells' specs kept rewriting, one copy each. HTTP-shaped only:
 * the persistence half is `@r10c/testing-cells/mongo`, so an `http` cell's
 * spec never pulls a driver in through this package.
 */

/** The claims of a vendor's session: `admin` in `org-1`, unless told otherwise. */
export const tokenClaims = (
  fields: Partial<TokenClaims> = {},
): TokenClaims => ({
  userId: 'u-1',
  subject: 'alan',
  sessionId: 's-1',
  roles: ['admin'],
  activeOrganizationId: 'org-1',
  ...fields,
});

/** The crossing token every cell spec's crossing policy accepts. */
export const CROSSING_TOKEN = 'fleet';

/**
 * Calls `path` the way a saga dispatches into a participant: the crossing
 * token, a JSON body, and — when given — the command id and the organization.
 */
export const crossingCall = (
  served: ServedRoutes,
  path: string,
  options: {
    readonly method?: string;
    readonly body?: unknown;
    readonly commandId?: string;
    readonly organizationId?: string;
  } = {},
): Promise<Response> =>
  served.call(path, {
    method: options.method ?? 'POST',
    headers: {
      'content-type': 'application/json',
      [CROSSING_TOKEN_HEADER]: CROSSING_TOKEN,
      // Every crossing write is idempotent on its key, so every call carries
      // one: the command a spec names, or a fresh one per call.
      [IDEMPOTENCY_KEY_HEADER]: formatIdempotencyKey(
        options.commandId ?? crypto.randomUUID(),
      ),
      ...(options.organizationId === undefined
        ? {}
        : { [ORGANIZATION_HEADER]: options.organizationId }),
    },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  });
