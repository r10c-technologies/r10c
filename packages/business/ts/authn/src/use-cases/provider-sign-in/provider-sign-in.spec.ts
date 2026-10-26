import { EntifixConnError } from '@entifix/core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { UserStatus } from '../../entities/user-identity/index.js';
import { AuthnError, UnauthenticatedError } from '../../errors/index.js';
import type { AccountRepository } from '../../repository/account.repository.js';
import type {
  ProviderDirectory,
  ProviderIdentity,
} from '../../repository/identity-provider-ports.js';
import { makeInMemoryAccountRepository } from '../../testing/in-memory-accounts.js';
import {
  provisionProviderHuman,
  resolveSignIn,
  splitName,
} from './provider-sign-in.js';

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

const identity = (fields: Partial<ProviderIdentity> = {}): ProviderIdentity => ({
  subject: 'sub-1',
  email: 'ada@example.com',
  emailVerified: true,
  displayName: 'Ada Lovelace',
  idToken: 'id-token',
  ...fields,
});

describe('resolveSignIn', () => {
  it('provisions a subject on first sight, with the verified address, and opens it', async () => {
    const accounts = makeInMemoryAccountRepository();

    const subject = await run(resolveSignIn(accounts, 'zitadel', identity()));

    expect(subject).toMatchObject({ subject: expect.any(String) });
    expect(await run(accounts.findByIdentifier('sub-1'))).toMatchObject({
      id: subject.userId,
      displayName: 'Ada Lovelace',
    });
    expect(await run(accounts.findContactAddress(subject.userId))).toBe(
      'ada@example.com',
    );
  });

  it('attaches no address the provider has not verified, and names a nameless user by username', async () => {
    const accounts = makeInMemoryAccountRepository();

    const subject = await run(
      resolveSignIn(
        accounts,
        'zitadel',
        identity({
          emailVerified: false,
          displayName: undefined,
          preferredUsername: 'ada',
        }),
      ),
    );

    expect(await run(accounts.findContactAddress(subject.userId))).toBeNull();
    expect(await run(accounts.findById(subject.userId))).toMatchObject({
      displayName: 'ada',
    });
  });

  it('resolves a known subject, and mirrors what the provider now says', async () => {
    const accounts = makeInMemoryAccountRepository();
    const first = await run(resolveSignIn(accounts, 'zitadel', identity()));

    const again = await run(
      resolveSignIn(
        accounts,
        'zitadel',
        identity({ displayName: 'Ada L.', email: 'ada@lovelace.dev' }),
      ),
    );

    expect(again.userId).toBe(first.userId);
    expect(await run(accounts.findById(first.userId))).toMatchObject({
      displayName: 'Ada L.',
    });
    expect(await run(accounts.findContactAddress(first.userId))).toBe(
      'ada@lovelace.dev',
    );
  });

  it('opens the subject it resolved when the account will not read back after the projection', async () => {
    const real = makeInMemoryAccountRepository();
    const { userId } = await run(resolveSignIn(real, 'zitadel', identity()));
    const forgetful: AccountRepository = {
      ...real,
      findById: () => Effect.succeed(null),
    };

    expect(
      (await run(resolveSignIn(forgetful, 'zitadel', identity()))).userId,
    ).toBe(userId);
  });

  it('opens no session for an account that is not active', async () => {
    const accounts = makeInMemoryAccountRepository();
    const { userId } = await run(
      resolveSignIn(accounts, 'zitadel', identity()),
    );
    await run(
      accounts.updateUserAspects(userId, { status: UserStatus.Suspended }),
    );

    const refused = await run(
      Effect.flip(resolveSignIn(accounts, 'zitadel', identity())),
    );

    expect(refused).toBeInstanceOf(UnauthenticatedError);
    expect(refused).toMatchObject({ code: 'accountInactive' });
  });

  it('reports a store that failed, or an account that will not read back, as a sign-in failure', async () => {
    const real = makeInMemoryAccountRepository();
    const broken: AccountRepository = {
      ...real,
      findByIdentifier: () => Effect.fail(new EntifixConnError('down')),
    };
    const forgetful: AccountRepository = {
      ...real,
      findById: () => Effect.succeed(null),
    };

    const failures = await Promise.all(
      [broken, forgetful].map(accounts =>
        run(Effect.flip(resolveSignIn(accounts, 'zitadel', identity()))),
      ),
    );

    expect(
      failures.every(
        failure =>
          failure instanceof AuthnError && failure.code === 'signInFailed',
      ),
    ).toBe(true);
  });
});

describe('provisionProviderHuman', () => {
  const directory = (existing?: string) => {
    const created: unknown[] = [];
    const subject: ProviderDirectory = {
      name: 'zitadel',
      findUserIdByEmail: () => Effect.succeed(existing),
      createHuman: human =>
        Effect.sync(() => {
          created.push(human);
          return 'provider-new';
        }),
    };
    return { subject, created };
  };

  it('creates the human when the provider holds none, and joins the two', async () => {
    const accounts = makeInMemoryAccountRepository();
    const { id } = await run(
      accounts.createAccount({ role: 'staff' as never, identifiers: [] }),
    );
    const { subject, created } = directory();

    const providerUserId = await run(
      provisionProviderHuman(accounts, subject, {
        userId: id,
        email: 'ada@example.com',
        displayName: 'Ada King Lovelace',
      }),
    );

    expect(providerUserId).toBe('provider-new');
    expect(created).toEqual([
      expect.objectContaining({
        username: 'ada@example.com',
        emailVerified: true,
        givenName: 'Ada King',
        familyName: 'Lovelace',
      }),
    ]);
    expect(await run(accounts.findByIdentifier('provider-new'))).toMatchObject(
      { id },
    );
  });

  it('adopts a human the provider already holds, which makes a retry a repair', async () => {
    const accounts = makeInMemoryAccountRepository();
    const { subject, created } = directory('provider-old');

    expect(
      await run(
        provisionProviderHuman(accounts, subject, {
          userId: 'u-1',
          email: 'ada@example.com',
          username: 'ada',
        }),
      ),
    ).toBe('provider-old');
    expect(created).toEqual([]);
  });

  it('reports a provider it cannot reach as providerUnavailable', async () => {
    const failed = await run(
      Effect.flip(
        provisionProviderHuman(
          makeInMemoryAccountRepository(),
          {
            name: 'zitadel',
            findUserIdByEmail: () => Effect.fail(new EntifixConnError('down')),
            createHuman: () => Effect.die('unused'),
          },
          { userId: 'u-1', email: 'ada@example.com' },
        ),
      ),
    );

    expect(failed).toMatchObject({ code: 'providerUnavailable' });
  });
});

describe('splitName', () => {
  it('splits on the last space, and fills a single name', () => {
    expect(splitName('Ada King Lovelace')).toEqual({
      givenName: 'Ada King',
      familyName: 'Lovelace',
    });
    expect(splitName('Ada')).toEqual({ givenName: 'Ada', familyName: '·' });
  });
});
