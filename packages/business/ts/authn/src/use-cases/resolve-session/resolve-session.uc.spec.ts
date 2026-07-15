import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { UnauthenticatedError } from '../../errors/authn-error.js';
import { IdentityProviderTag, SessionIdTag } from '../../repository/identity-provider.repository.js';
import type { Principal } from '../../values/principal.js';
import { resolveSessionUCFactory } from './resolve-session.uc.js';

const stubProvider = (principal: Principal) =>
  IdentityProviderTag.of({
    resolveSession: sessionId =>
      sessionId === principal.sessionId
        ? Effect.succeed(principal)
        : Effect.fail(new UnauthenticatedError('unknown session')),
    resolveIdentifier: () =>
      Effect.fail(new UnauthenticatedError('not implemented in stub')),
  });

describe('resolveSessionUCFactory', () => {
  const principal: Principal = {
    userId: 'user-1',
    subject: 'zitadel-sub-1',
    sessionId: 'sess-1',
    roles: ['catalog:reader'],
    attributes: { department: 'sales' },
  };

  it('resolves the session id in context to the principal', async () => {
    const result = await Effect.runPromise(
      resolveSessionUCFactory().pipe(
        Effect.provideService(IdentityProviderTag, stubProvider(principal)),
        Effect.provideService(SessionIdTag, 'sess-1')
      )
    );

    expect(result).toEqual(principal);
  });

  it('fails with UnauthenticatedError for an unknown session', async () => {
    const exit = await Effect.runPromiseExit(
      resolveSessionUCFactory().pipe(
        Effect.provideService(IdentityProviderTag, stubProvider(principal)),
        Effect.provideService(SessionIdTag, 'nope')
      )
    );

    expect(exit._tag).toBe('Failure');
  });
});
