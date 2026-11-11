import {
  type SessionData,
  type SessionLifetimeSeconds,
  type SessionRecord,
  SessionStoreTag,
} from '@entifix/business';
import { describeEntityUseCases, NotFound } from '@entifix/core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { UserIdentity } from '../../entities/user-identity/index.js';
import { NotAMember } from '../../errors/index.js';
import {
  IdTokenStoreTag,
  ProviderSessionIndexTag,
  SessionScopeResolverTag,
} from '../../repository/index.js';
import {
  makeInMemoryIdTokenStore,
  makeInMemoryProviderSessionIndex,
  makeInMemorySessionScopeResolver,
} from '../../testing/index.js';
import { SESSION_IDLE_TTL_SECONDS } from '../../values/index.js';
import {
  providerSessionOf,
  SWITCH_ORGANIZATION,
  SwitchOrganizationInputTag,
  SwitchOrganizationUC,
} from './switch-organization.uc.js';

/** A token whose payload names `sid`, as the provider's id_token does. */
const idTokenWith = (payload: Record<string, unknown>) =>
  `h.${btoa(JSON.stringify(payload)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')}.s`;

const HOUR = 3_600_000;

/** Sessions in a map, with what each was created with. */
const makeSessions = (absoluteExpiresAt: string) => {
  const records = new Map<string, SessionRecord>();
  const lifetimes = new Map<string, SessionLifetimeSeconds>();
  records.set('s-old', {
    sessionId: 's-old',
    userId: 'u-1',
    subject: 'u-1',
    roles: ['user'],
    attributes: { locale: 'es' },
    activeOrganizationId: 'org-a',
    partyRole: 'customer',
    partyId: 'p-1',
    entitlements: [],
    device: { deviceId: 'd-1', browser: 'Firefox' },
    createdAt: new Date(Date.now() - HOUR).toISOString(),
    expiresAt: new Date(Date.now() + HOUR).toISOString(),
    absoluteExpiresAt,
  });
  const store = SessionStoreTag.of({
    create: (data: SessionData, lifetime: SessionLifetimeSeconds) =>
      Effect.sync(() => {
        records.set('s-new', {
          ...data,
          sessionId: 's-new',
          createdAt: new Date().toISOString(),
          expiresAt: new Date().toISOString(),
          absoluteExpiresAt,
        });
        lifetimes.set('s-new', lifetime);
        return 's-new';
      }),
    read: sessionId =>
      records.has(sessionId)
        ? Effect.succeed(records.get(sessionId) as SessionRecord)
        : Effect.fail(new NotFound({ entity: 'session' })),
    touch: () => Effect.void,
    listForUser: () => Effect.succeed([...records.values()]),
    revoke: sessionId => Effect.sync(() => void records.delete(sessionId)),
    revokeAllForUser: () => Effect.void,
    revokeAllForUserExcept: () => Effect.void,
  });
  return { store, records, lifetimes };
};

const resolver = makeInMemorySessionScopeResolver({
  individuals: [{ id: 'p-1', userId: 'u-1' }],
  memberships: [
    { partyId: 'p-1', organizationId: 'org-a', isDefault: true },
    { partyId: 'p-1', organizationId: 'org-b' },
  ],
  roles: [{ partyId: 'p-1', role: 'vendor', organizationId: 'org-b' }],
  entitlements: [{ organizationId: 'org-b', domains: ['catalog'] }],
  organizations: [],
});

const switchTo = (
  organizationId: string,
  options: { idToken?: string; ceiling?: number } = {},
) => {
  const sessions = makeSessions(
    new Date(Date.now() + (options.ceiling ?? 10 * HOUR)).toISOString(),
  );
  const idTokens = makeInMemoryIdTokenStore();
  const providerSessions = makeInMemoryProviderSessionIndex();
  const run = <A, E>(
    effect: Effect.Effect<
      A,
      E,
      | SessionStoreTag
      | SessionScopeResolverTag
      | IdTokenStoreTag
      | ProviderSessionIndexTag
    >,
  ) =>
    Effect.runPromise(
      effect.pipe(
        Effect.provideService(SessionStoreTag, sessions.store),
        Effect.provideService(SessionScopeResolverTag, resolver),
        Effect.provideService(IdTokenStoreTag, idTokens),
        Effect.provideService(ProviderSessionIndexTag, providerSessions),
      ),
    );
  const result = run(
    Effect.gen(function* () {
      if (options.idToken !== undefined) {
        yield* idTokens.remember('s-old', options.idToken);
      }
      return yield* SwitchOrganizationUC.run().pipe(
        Effect.provideService(SwitchOrganizationInputTag, {
          userId: 'u-1',
          sessionId: 's-old',
          organizationId,
        }),
        Effect.result,
      );
    }),
  );
  return { result, sessions, idTokens, providerSessions, run };
};

describe('SwitchOrganizationUC', () => {
  it('opens a new session in the chosen membership and revokes the old one', async () => {
    const { result, sessions } = switchTo('org-b');

    const outcome = await result;

    expect(outcome._tag).toBe('Success');
    expect(sessions.records.has('s-old')).toBe(false);
    expect(sessions.records.get('s-new')).toMatchObject({
      userId: 'u-1',
      roles: ['user'],
      attributes: { locale: 'es' },
      activeOrganizationId: 'org-b',
      partyRole: 'vendor',
      entitlements: ['catalog'],
      device: { deviceId: 'd-1', browser: 'Firefox' },
    });
  });

  it('keeps the old session’s ceiling, so switching never extends it', async () => {
    const { result, sessions } = switchTo('org-b', { ceiling: 2 * HOUR });

    await result;

    const lifetime = sessions.lifetimes.get('s-new');
    expect(lifetime?.absoluteTtlSeconds).toBeGreaterThan(7_190);
    expect(lifetime?.absoluteTtlSeconds).toBeLessThanOrEqual(7_200);
    expect(lifetime?.idleTtlSeconds).toBe(lifetime?.absoluteTtlSeconds);
  });

  it('caps the idle window at the policy when the ceiling is further off', async () => {
    const { result, sessions } = switchTo('org-b', { ceiling: 30 * 24 * HOUR });

    await result;

    expect(sessions.lifetimes.get('s-new')?.idleTtlSeconds).toBe(
      SESSION_IDLE_TTL_SECONDS,
    );
  });

  it('moves the provider’s logout to the new session', async () => {
    const idToken = idTokenWith({ sid: 'provider-sid' });
    const { result, idTokens, providerSessions, run } = switchTo('org-b', {
      idToken,
    });

    await result;

    expect(await run(idTokens.take('s-old'))).toBeUndefined();
    expect(await run(idTokens.take('s-new'))).toBe(idToken);
    expect(await run(providerSessions.take('provider-sid'))).toEqual(['s-new']);
  });

  it('moves the id_token even when it names no provider session', async () => {
    const idToken = idTokenWith({ sub: 'u-1' });
    const { result, idTokens, run } = switchTo('org-b', { idToken });

    await result;

    expect(await run(idTokens.take('s-new'))).toBe(idToken);
  });

  it('refuses an organization the caller is no member of, and changes nothing', async () => {
    const { result, sessions } = switchTo('org-c');

    const outcome = await result;

    expect(outcome._tag).toBe('Failure');
    expect(
      outcome._tag === 'Failure' ? outcome.failure : undefined,
    ).toBeInstanceOf(NotAMember);
    expect([...sessions.records.keys()]).toEqual(['s-old']);
  });

  it('is unbound, needs no confirmation, and derives its permission', () => {
    const descriptor = describeEntityUseCases(UserIdentity).find(
      candidate => candidate.key === 'switch-organization',
    );

    expect(descriptor?.binding).toBe('unbound');
    expect(descriptor?.confirm).toBeUndefined();
    expect(SWITCH_ORGANIZATION).toBe('authn:user-identity:switch-organization');
  });
});

describe('providerSessionOf', () => {
  it('reads `sid` from an id_token’s payload', () => {
    expect(providerSessionOf(idTokenWith({ sid: 'abc' }))).toBe('abc');
  });

  it('answers nothing for a payload without one, or a token that is not one', () => {
    expect(providerSessionOf(idTokenWith({ sid: 7 }))).toBeUndefined();
    expect(providerSessionOf('no-dots')).toBeUndefined();
    expect(providerSessionOf('h.%%%.s')).toBeUndefined();
  });
});
