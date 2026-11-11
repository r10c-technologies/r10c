import { type SessionRecord, SessionStoreTag } from '@entifix/business';
import { describeEntityUseCases, NotFound, Unavailable } from '@entifix/core';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { UserDevice } from '../../entities/user-device/index.js';
import {
  SIGN_OUT_SESSION,
  SignOutSessionInputTag,
  SignOutSessionUC,
} from './sign-out-session.uc.js';

// Fails loudly if a path the use case must not take is taken.
const unused = (name: string) =>
  Effect.fail(new Unavailable({ dependency: `${name} is not used here` }));

const record = (sessionId: string, userId: string): SessionRecord => ({
  sessionId,
  userId,
  subject: userId,
  roles: ['user'],
  attributes: {},
  createdAt: '2026-11-11T00:00:00.000Z',
  expiresAt: '2026-11-11T01:00:00.000Z',
  absoluteExpiresAt: '2026-11-12T00:00:00.000Z',
});

const stubSessions = (owner: string, revoked: string[]) =>
  SessionStoreTag.of({
    create: () => unused('create'),
    read: sessionId =>
      sessionId === 'session-gone'
        ? Effect.fail(new NotFound({ entity: 'session' }))
        : Effect.succeed(record(sessionId, owner)),
    touch: () => unused('touch'),
    listForUser: () => unused('listForUser'),
    revoke: sessionId => {
      revoked.push(sessionId);
      return Effect.void;
    },
    revokeAllForUser: () => unused('revokeAllForUser'),
    revokeAllForUserExcept: () => unused('revokeAllForUserExcept'),
  });

const run = (sessionId: string, owner: string, revoked: string[]) =>
  Effect.runPromiseExit(
    SignOutSessionUC.run().pipe(
      Effect.provideService(SignOutSessionInputTag, {
        userId: 'user-1',
        sessionId,
        currentSessionId: 'session-mine',
      }),
      Effect.provideService(SessionStoreTag, stubSessions(owner, revoked)),
    ),
  );

describe('SignOutSessionUC', () => {
  it('ends another of the caller’s sessions and stays signed in', async () => {
    const revoked: string[] = [];

    const exit = await run('session-other', 'user-1', revoked);

    expect(exit).toEqual(Exit.succeed({ signedOut: false }));
    expect(revoked).toEqual(['session-other']);
  });

  it('signs the caller out when the session is the one in use', async () => {
    const revoked: string[] = [];

    const exit = await run('session-mine', 'user-1', revoked);

    expect(exit).toEqual(Exit.succeed({ signedOut: true }));
    expect(revoked).toEqual(['session-mine']);
  });

  it('answers somebody else’s session as absent, and revokes nothing', async () => {
    const revoked: string[] = [];

    const failure = await Effect.runPromise(
      SignOutSessionUC.run().pipe(
        Effect.flip,
        Effect.provideService(SignOutSessionInputTag, {
          userId: 'user-1',
          sessionId: 'session-theirs',
          currentSessionId: 'session-mine',
        }),
        Effect.provideService(SessionStoreTag, stubSessions('user-2', revoked)),
      ),
    );

    expect(failure).toBeInstanceOf(NotFound);
    expect(revoked).toEqual([]);
  });

  it('fails when the session does not exist', async () => {
    const revoked: string[] = [];

    const exit = await run('session-gone', 'user-1', revoked);

    expect(Exit.isFailure(exit)).toBe(true);
    expect(revoked).toEqual([]);
  });

  it('sits in a row’s menu, inline, and asks before it runs', () => {
    const descriptor = describeEntityUseCases(UserDevice).find(
      candidate => candidate.key === 'sign-out-session',
    );

    expect(descriptor?.binding).toBe('entity');
    expect(descriptor?.placement).toBe('context-dependent');
    expect(descriptor?.rowInline).toBe(true);
    expect(descriptor?.confirm?.tone).toBe('destructive');
    expect(descriptor?.reversible).toBe('confirm');
  });

  it('derives its permission rather than restating the verb', () => {
    expect(SIGN_OUT_SESSION).toBe('authn:user-device:sign-out-session');
  });
});
