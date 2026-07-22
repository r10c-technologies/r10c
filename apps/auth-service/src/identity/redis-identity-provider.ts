import {
  type AccountRepository,
  type IdentityProvider,
  type Principal,
  UnauthenticatedError,
} from '@r10c/business-ts-authn';
import type { SessionRecord, SessionStore } from '@r10c/entifix-ts-business';
import { Effect } from 'effect';

/** A stored session record becomes the {@link Principal} carried per request. */
const toPrincipal = (record: SessionRecord): Principal => ({
  userId: record.userId,
  subject: record.subject,
  sessionId: record.sessionId,
  roles: record.roles,
  attributes: record.attributes,
});

/**
 * The real {@link IdentityProvider} that replaces the stub: sessions resolve
 * straight out of Redis (the single source of truth every service could read),
 * and identifier lookups go through the Mongo-backed account repository. A
 * missing session surfaces as the store's error, which the perimeter collapses
 * to `401`.
 */
export const makeRedisIdentityProvider = (
  sessionStore: SessionStore,
  accounts: AccountRepository,
): IdentityProvider => ({
  resolveSession: (sessionId) =>
    sessionStore.read(sessionId).pipe(Effect.map(toPrincipal)),
  resolveIdentifier: (_type, value) =>
    accounts.findByIdentifier(value).pipe(
      Effect.flatMap((user) =>
        user === null
          ? Effect.fail(new UnauthenticatedError('unknown identifier'))
          : Effect.succeed(user),
      ),
    ),
});
