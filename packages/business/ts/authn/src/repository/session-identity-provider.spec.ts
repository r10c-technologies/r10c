import type { SessionRecord } from '@entifix/business';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { UserIdentity } from '../entities/user-identity/index.js';
import { UnauthenticatedError } from '../errors/index.js';
import type { AccountRepository } from './account.repository.js';
import { makeSessionIdentityProvider } from './session-identity-provider.js';
import { IdTokenStoreTag, SessionScopeResolverTag } from './session-stores.js';

const record: SessionRecord = {
  sessionId: 's-1',
  userId: 'u-1',
  subject: 'alan',
  roles: ['admin'],
  activeOrganizationId: 'acme',
  partyRole: 'vendor',
  partyId: 'p-1',
  attributes: {},
} as unknown as SessionRecord;

const alan = Object.assign(new UserIdentity(), { id: 'u-1' });

const provider = makeSessionIdentityProvider(
  {
    read: () => Effect.succeed(record),
  } as never,
  {
    findByIdentifier: (value: string) =>
      Effect.succeed(value === 'alan@example.com' ? alan : null),
  } as unknown as AccountRepository,
);

describe('makeSessionIdentityProvider', () => {
  it('resolves a session to the principal its record names', async () => {
    expect(await Effect.runPromise(provider.resolveSession('s-1'))).toEqual({
      userId: 'u-1',
      subject: 'alan',
      sessionId: 's-1',
      roles: ['admin'],
      organizationId: 'acme',
      partyRole: 'vendor',
      partyId: 'p-1',
      attributes: {},
    });
  });

  it('resolves a known identifier, and refuses an unknown one', async () => {
    expect(
      await Effect.runPromise(
        provider.resolveIdentifier('email', 'alan@example.com'),
      ),
    ).toBe(alan);
    expect(
      await Effect.runPromise(
        Effect.flip(provider.resolveIdentifier('email', 'nobody@example.com')),
      ),
    ).toBeInstanceOf(UnauthenticatedError);
  });
});

describe('the session ports', () => {
  it('are distinct services', () => {
    expect(IdTokenStoreTag.key).not.toBe(SessionScopeResolverTag.key);
  });
});
