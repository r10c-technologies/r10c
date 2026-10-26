import { EntifixConnError } from '@entifix/core';
import { makeFakeMongoDb } from '@entifix/testing-unit/drivers';
import {
  AuthnError,
  IdentifierType,
  UserIdentity,
} from '@r10c/business-ts-authn';
import { Effect } from 'effect';
import type { Db } from 'mongodb';
import { describe, expect, it } from 'vitest';

import {
  IDENTIFIER_COLLECTION,
  makeMongoAccountRepository,
  USER_COLLECTION,
} from './account-repository.js';
import {
  makeDevNotificationPort,
  OUTBOX_COLLECTION,
  OUTBOX_PAGE_SIZE,
  readOutbox,
} from './notifications.js';
import {
  DEVICE_COLLECTION,
  makeMongoUserDeviceRepository,
} from './user-device-repository.js';

type Fake = ReturnType<typeof makeFakeMongoDb>;
type Seed = Record<string, Record<string, unknown>[]>;

/**
 * Fail only the `nth` call of one operation on one collection. The
 * repositories capture their collections when they are built, so this wraps
 * the database before they are.
 */
const failNth = (fake: Fake, collection: string, op: string, nth: number) => {
  const db = fake.db as unknown as { collection: (name: string) => object };
  const real = db.collection.bind(db);
  let calls = 0;
  db.collection = (name: string) => {
    const handle = real(name) as Record<
      string,
      (...args: unknown[]) => unknown
    >;
    if (name !== collection) return handle;
    return new Proxy(handle, {
      get: (target, key) =>
        key !== op
          ? target[key as string]
          : (...args: unknown[]) => {
              calls += 1;
              if (calls !== nth) {
                return (target[op] as (...a: unknown[]) => unknown)(...args);
              }
              const failure = () =>
                Promise.reject(new Error(`${op} #${nth} failed`));
              // `find` answers a cursor; it is the cursor's read that fails.
              return op === 'find' ? { toArray: failure } : failure();
            },
    });
  };
};

const ALAN = {
  id: 'u-1',
  displayName: 'Alan',
  status: 'active',
  role: 'admin',
  identifiers: ['i-1'],
};
const ALAN_EMAIL = {
  id: 'i-1',
  userId: 'u-1',
  type: IdentifierType.Email,
  value: 'alan@example.com',
  verified: true,
};

const seeded = (): Seed => ({
  [USER_COLLECTION]: [{ ...ALAN }],
  [IDENTIFIER_COLLECTION]: [{ ...ALAN_EMAIL }],
});

const accounts = (seed: Seed = seeded(), fail?: [string, string, number]) => {
  const fake = makeFakeMongoDb(seed);
  if (fail) failNth(fake, ...fail);
  return { fake, repository: makeMongoAccountRepository(fake.db as Db) };
};

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);
const flip = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromise(Effect.flip(effect));

describe('the account repository', () => {
  it('finds a user by identifier and by id, and answers null for neither', async () => {
    const { repository } = accounts();

    const byIdentifier = await run(
      repository.findByIdentifier('alan@example.com'),
    );
    const byId = await run(repository.findById('u-1'));

    expect(byIdentifier).toBeInstanceOf(UserIdentity);
    expect(byId?.id).toBe('u-1');
    expect(await run(repository.findByIdentifier('nobody'))).toBeNull();
    // An identifier left pointing at a user that is gone reads as nobody.
    expect(
      await run(
        accounts({
          [USER_COLLECTION]: [],
          [IDENTIFIER_COLLECTION]: [{ ...ALAN_EMAIL }],
        }).repository.findByIdentifier('alan@example.com'),
      ),
    ).toBeNull();
    expect(await run(repository.findById('u-9'))).toBeNull();
  });

  it('answers a contact address, or null when there is none', async () => {
    const { repository } = accounts();

    expect(await run(repository.findContactAddress('u-1'))).toBe(
      'alan@example.com',
    );
    expect(await run(repository.findContactAddress('u-9'))).toBeNull();
  });

  it('updates a role and a status, and refuses a user that is gone', async () => {
    const { fake, repository } = accounts();

    const updated = await run(
      repository.updateUserAspects('u-1', {
        role: 'user',
        status: 'disabled',
      }),
    );
    await run(repository.updateUserAspects('u-1', {}));
    const gone = await flip(
      repository.updateUserAspects('u-9', { role: 'user' }),
    );

    expect(updated.id).toBe('u-1');
    expect(fake.read(USER_COLLECTION)[0]).toMatchObject({
      role: 'user',
      status: 'disabled',
    });
    expect(gone).toBeInstanceOf(AuthnError);
  });

  it('links an external subject once, re-pointing the identifier it already has', async () => {
    const { fake, repository } = accounts();

    await run(repository.linkExternalSubject('u-1', 'zitadel-1', 'zitadel'));
    await run(repository.linkExternalSubject('u-1', 'zitadel-2', 'zitadel'));

    const external = fake
      .read(IDENTIFIER_COLLECTION)
      .filter(doc => doc['type'] === IdentifierType.ExternalSubject);
    expect(external).toHaveLength(1);
    expect(external[0]).toMatchObject({ value: 'zitadel-2', verified: true });
  });

  it('projects a display name and an email, attaching the email when there was none', async () => {
    const { fake, repository } = accounts({
      [USER_COLLECTION]: [{ ...ALAN, identifiers: [] }],
      [IDENTIFIER_COLLECTION]: [],
    });

    await run(
      repository.projectIdentity('u-1', {
        displayName: 'Alan T.',
        email: 'alan@example.com',
        emailVerified: false,
      }),
    );
    await run(
      repository.projectIdentity('u-1', {
        email: 'alan@turing.example',
        emailVerified: true,
      }),
    );
    await run(repository.projectIdentity('u-1', { emailVerified: false }));

    expect(fake.read(USER_COLLECTION)[0]?.['displayName']).toBe('Alan T.');
    expect(fake.read(IDENTIFIER_COLLECTION)).toEqual([
      expect.objectContaining({
        value: 'alan@turing.example',
        verified: true,
      }),
    ]);
  });

  it('creates an account with its identifiers, and refuses one already in use', async () => {
    const { fake, repository } = accounts();

    const created = await run(
      repository.createAccount({
        displayName: 'Grace',
        role: 'user',
        identifiers: [
          { type: IdentifierType.Email, value: 'grace@example.com' },
          {
            type: IdentifierType.ExternalSubject,
            value: 'zitadel-9',
            provider: 'zitadel',
            verified: true,
          },
        ],
      } as never),
    );
    const taken = await flip(
      repository.createAccount({
        displayName: 'Alan again',
        role: 'user',
        identifiers: [
          { type: IdentifierType.Email, value: 'alan@example.com' },
        ],
      } as never),
    );

    expect(created.displayName).toBe('Grace');
    expect(fake.read(IDENTIFIER_COLLECTION)).toHaveLength(3);
    expect(taken).toBeInstanceOf(AuthnError);
  });

  it('reports every driver failure as a store failure', async () => {
    const cases: [
      [string, string, number],
      (
        r: ReturnType<typeof makeMongoAccountRepository>,
      ) => Effect.Effect<unknown, unknown>,
    ][] = [
      [
        [IDENTIFIER_COLLECTION, 'findOne', 1],
        r => r.findByIdentifier('alan@example.com'),
      ],
      [
        [USER_COLLECTION, 'findOne', 1],
        r => r.findByIdentifier('alan@example.com'),
      ],
      [[USER_COLLECTION, 'findOne', 1], r => r.findById('u-1')],
      [
        [USER_COLLECTION, 'updateOne', 1],
        r => r.updateUserAspects('u-1', { role: 'user' }),
      ],
      [[IDENTIFIER_COLLECTION, 'findOne', 1], r => r.findContactAddress('u-1')],
      [
        [IDENTIFIER_COLLECTION, 'findOne', 1],
        r => r.linkExternalSubject('u-1', 's', 'p'),
      ],
      [
        [IDENTIFIER_COLLECTION, 'insertMany', 1],
        r => r.linkExternalSubject('u-1', 's', 'p'),
      ],
      [
        [USER_COLLECTION, 'updateOne', 1],
        r => r.linkExternalSubject('u-1', 's', 'p'),
      ],
      [
        [IDENTIFIER_COLLECTION, 'updateOne', 1],
        r =>
          Effect.andThen(
            r.linkExternalSubject('u-1', 's', 'p'),
            r.linkExternalSubject('u-1', 't', 'p'),
          ),
      ],
      [
        [USER_COLLECTION, 'updateOne', 1],
        r =>
          r.projectIdentity('u-1', { displayName: 'x', emailVerified: false }),
      ],
      [
        [IDENTIFIER_COLLECTION, 'findOne', 1],
        r =>
          r.projectIdentity('u-1', {
            email: 'x@example.com',
            emailVerified: true,
          }),
      ],
      [
        [IDENTIFIER_COLLECTION, 'updateOne', 1],
        r =>
          r.projectIdentity('u-1', {
            email: 'x@example.com',
            emailVerified: true,
          }),
      ],
      [
        [IDENTIFIER_COLLECTION, 'findOne', 1],
        r =>
          r.createAccount({
            displayName: 'x',
            role: 'user',
            identifiers: [
              { type: IdentifierType.Email, value: 'x@example.com' },
            ],
          } as never),
      ],
      [
        [USER_COLLECTION, 'insertMany', 1],
        r =>
          r.createAccount({
            displayName: 'x',
            role: 'user',
            identifiers: [
              { type: IdentifierType.Email, value: 'x@example.com' },
            ],
          } as never),
      ],
      [
        [IDENTIFIER_COLLECTION, 'insertMany', 1],
        r =>
          r.createAccount({
            displayName: 'x',
            role: 'user',
            identifiers: [
              { type: IdentifierType.Email, value: 'x@example.com' },
            ],
          } as never),
      ],
    ];
    for (const [fail, act] of cases) {
      const { repository } = accounts(seeded(), fail);

      expect(await flip(act(repository))).toBeInstanceOf(EntifixConnError);
    }
  });
});

describe('the device repository', () => {
  const device = (ip: string) => ({
    deviceId: 'd-1',
    browser: 'Firefox',
    os: 'macOS',
    type: 'desktop',
    ip,
  });

  it('remembers a new device, then recognises it and moves its last sighting', async () => {
    const fake = makeFakeMongoDb();
    const devices = makeMongoUserDeviceRepository(fake.db as Db);

    const first = await run(
      devices.remember('u-1', device('10.0.0.1') as never),
    );
    const again = await run(
      devices.remember('u-1', device('10.0.0.2') as never),
    );

    expect([first.isNew, again.isNew]).toEqual([true, false]);
    expect(fake.read(DEVICE_COLLECTION)).toEqual([
      expect.objectContaining({ lastIp: '10.0.0.2' }),
    ]);
  });

  it('keeps a first sighting it has, and starts one for a device stored without', async () => {
    const fake = makeFakeMongoDb({
      [DEVICE_COLLECTION]: [{ id: 'kept', userId: 'u-1', deviceId: 'd-1' }],
    });
    const devices = makeMongoUserDeviceRepository(fake.db as Db);

    const remembered = await run(
      devices.remember('u-1', device('ip') as never),
    );

    expect(remembered.device.id).toBe('kept');
  });

  it('lists a user’s devices most recently seen first, an unseen one last', async () => {
    const fake = makeFakeMongoDb({
      [DEVICE_COLLECTION]: [
        {
          id: 'a',
          userId: 'u-1',
          deviceId: 'old',
          lastSeenAt: new Date('2026-01-01'),
        },
        {
          id: 'b',
          userId: 'u-1',
          deviceId: 'new',
          lastSeenAt: new Date('2026-06-01'),
        },
        { id: 'c', userId: 'u-1', deviceId: 'never' },
        {
          id: 'd',
          userId: 'u-1',
          deviceId: 'text',
          lastSeenAt: '2026-03-01T00:00:00.000Z',
        },
      ],
    });
    const devices = makeMongoUserDeviceRepository(fake.db as Db);

    const listed = await run(devices.listForUser('u-1'));

    expect(listed.map(one => one.deviceId)).toEqual([
      'new',
      'text',
      'old',
      'never',
    ]);
  });

  it('reports every driver failure as a store failure', async () => {
    const cases: [
      string,
      number,
      (
        r: ReturnType<typeof makeMongoUserDeviceRepository>,
      ) => Effect.Effect<unknown, unknown>,
    ][] = [
      ['findOne', 1, r => r.remember('u-1', device('ip') as never)],
      ['insertMany', 1, r => r.remember('u-1', device('ip') as never)],
      [
        'updateOne',
        1,
        r =>
          Effect.andThen(
            r.remember('u-1', device('ip') as never),
            r.remember('u-1', device('ip') as never),
          ),
      ],
      ['find', 1, r => r.listForUser('u-1')],
    ];
    for (const [op, nth, act] of cases) {
      const fake = makeFakeMongoDb();
      failNth(fake, DEVICE_COLLECTION, op, nth);
      const devices = makeMongoUserDeviceRepository(fake.db as Db);

      expect(await flip(act(devices))).toBeInstanceOf(EntifixConnError);
    }
  });
});

describe('the dev notification outbox', () => {
  it('records each notification, and reads back the newest first, one page at most', async () => {
    const fake = makeFakeMongoDb();
    const port = makeDevNotificationPort(fake.db as Db);

    await run(
      port.send({
        kind: 'welcome',
        to: 'alan@example.com',
        userId: 'u-1',
      } as never),
    );
    await run(
      port.send({
        kind: 'reset',
        to: 'grace@example.com',
        userId: 'u-2',
        data: { code: 1 },
      } as never),
    );
    const every = await run(readOutbox(fake.db as Db));
    const alans = await run(readOutbox(fake.db as Db, 'alan@example.com'));

    expect(every).toHaveLength(2);
    expect(alans.map(doc => doc['kind'])).toEqual(['welcome']);
    expect(OUTBOX_PAGE_SIZE).toBeGreaterThan(0);
    expect(fake.read(OUTBOX_COLLECTION)[0]?.['data']).toEqual({});
  });

  it('reports a write or a read the driver failed as a store failure', async () => {
    const writes = makeFakeMongoDb();
    writes.failOn('insertMany', new Error('disk full'));
    const reads = makeFakeMongoDb();
    reads.failOn('find', new Error('network down'));

    expect(
      await flip(
        makeDevNotificationPort(writes.db as Db).send({
          kind: 'k',
          to: 't',
          userId: 'u',
        } as never),
      ),
    ).toBeInstanceOf(EntifixConnError);
    expect(await flip(readOutbox(reads.db as Db))).toBeInstanceOf(
      EntifixConnError,
    );
  });
});
