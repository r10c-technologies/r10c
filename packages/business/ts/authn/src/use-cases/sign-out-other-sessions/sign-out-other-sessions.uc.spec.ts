import { SessionStoreTag } from '@r10c/entifix-ts-business';
import {
  describeEntityUseCases,
  EntifixLogicError,
  type EntityId,
} from '@r10c/entifix-ts-core';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { UserIdentity } from '../../entities/user-identity/index.js';
import {
  SIGN_OUT_OTHERS,
  SignOutOtherSessionsInputTag,
  SignOutOtherSessionsUC,
} from './sign-out-other-sessions.uc.js';

const unused = (name: string) =>
  Effect.fail(new EntifixLogicError(`${name} not used in sign-out-others`));

const stubSessions = (
  onRevoke: (userId: EntityId, keep: string) => void,
  outcome: Effect.Effect<void, EntifixLogicError> = Effect.void,
) =>
  SessionStoreTag.of({
    create: () => unused('create'),
    read: () => unused('read'),
    touch: () => unused('touch'),
    listForUser: () => unused('listForUser'),
    revoke: () => unused('revoke'),
    revokeAllForUser: () => unused('revokeAllForUser'),
    revokeAllForUserExcept: (userId, keepSessionId) => {
      onRevoke(userId, keepSessionId);
      return outcome;
    },
  });

const run = (sessions: ReturnType<typeof stubSessions>) =>
  Effect.runPromiseExit(
    SignOutOtherSessionsUC.run().pipe(
      Effect.provideService(SignOutOtherSessionsInputTag, {
        userId: 'user-1',
        keepSessionId: 'session-mine',
      }),
      Effect.provideService(SessionStoreTag, sessions),
    ),
  );

describe('SignOutOtherSessionsUC', () => {
  it('ends every other session and spares the one making the request', async () => {
    const calls: Array<[EntityId, string]> = [];

    const exit = await run(stubSessions((id, keep) => calls.push([id, keep])));

    expect(Exit.isSuccess(exit)).toBe(true);
    expect(calls).toEqual([['user-1', 'session-mine']]);
  });

  it('fails when the session store does', async () => {
    const exit = await run(
      stubSessions(
        () => undefined,
        Effect.fail(new EntifixLogicError('redis is down')),
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
  });

  it('is unbound — it takes no record and no selection', () => {
    const descriptor = describeEntityUseCases(UserIdentity).find(
      candidate => candidate.key === 'sign-out-others',
    );

    expect(descriptor?.binding).toBe('unbound');
    expect(descriptor?.placement).toBe('context-independent');
  });

  it('asks before it runs, in the destructive tone', () => {
    const descriptor = describeEntityUseCases(UserIdentity).find(
      candidate => candidate.key === 'sign-out-others',
    );

    expect(descriptor?.confirm?.tone).toBe('destructive');
    expect(descriptor?.keywordsKey).toBeDefined();
  });

  it('derives its permission rather than restating the verb', () => {
    expect(SIGN_OUT_OTHERS).toBe('authn:user-identity:sign-out-others');
  });
});
