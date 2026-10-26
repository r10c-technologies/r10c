import type { SessionRecord, SessionStore } from '@entifix/business';
import { Effect } from 'effect';

import { UnauthenticatedError } from '../errors';
import type { Principal } from '../values';
import type { AccountRepository } from './account.repository';
import type { IdentityProvider } from './identity-provider.repository';

const toPrincipal = (record: SessionRecord): Principal => ({
  userId: record.userId,
  subject: record.subject,
  sessionId: record.sessionId,
  roles: record.roles,
  organizationId: record.activeOrganizationId,
  partyRole: record.partyRole,
  partyId: record.partyId,
  attributes: record.attributes,
});

/**
 * The identity provider r10c answers from its own records: a session from
 * the session store, an identifier from the accounts. Which engines back the
 * two is the host's choice; this is only the composition (ADR 0016 — Zitadel
 * authenticates, r10c resolves).
 */
export const makeSessionIdentityProvider = (
  sessionStore: SessionStore,
  accounts: AccountRepository,
): IdentityProvider => ({
  resolveSession: sessionId =>
    sessionStore.read(sessionId).pipe(Effect.map(toPrincipal)),
  resolveIdentifier: (_type, value) =>
    accounts
      .findByIdentifier(value)
      .pipe(
        Effect.flatMap(user =>
          user === null
            ? Effect.fail(new UnauthenticatedError('unknown identifier'))
            : Effect.succeed(user),
        ),
      ),
});
