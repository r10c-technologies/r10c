import { generateKeyPairSync } from 'node:crypto';

import { SessionStoreTag } from '@entifix/business';
import { MongoDatabaseTag } from '@entifix/mongo';
import { ensureOutboxIndexes } from '@entifix/mongo/transactions';
import { makeRecordingEventBus } from '@entifix/testing-unit';
import { makeFakeMongoDb } from '@entifix/testing-unit/drivers';
import { EventBusTag, EventSourceTag } from '@entifix/transactions';
import {
  AccountRepositoryTag,
  IdentityProviderTag,
} from '@r10c/business-ts-authn';
import { ORGANIZATION_COLLECTION } from '@r10c/implementation-auth-mongo';
import {
  configurationRows,
  fleetConfigurationOf,
} from '@r10c/shells-effect-service';
import { Effect, Fiber, Layer, Logger, References } from 'effect';
import type { Db } from 'mongodb';
import { describe, expect, it } from 'vitest';

import { IdentityProviderLayer } from './app-layer.js';
import {
  authComposition,
  JWT_AUDIENCE,
  JWT_ISSUER,
  makeAppLayer,
  rebuildAndReport,
  reportSeedShortfalls,
  router,
  startOrganizationRebuild,
} from './index.js';

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});

const CONFIGURATION = fleetConfigurationOf({
  jwt: configurationRows({
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    keyId: 'spec-key',
  }),
  mongo: configurationRows({
    uri: 'mongodb://127.0.0.1:1/?directConnection=true',
    db: 'auth',
  }),
  redis: configurationRows({ uri: 'redis://127.0.0.1:1' }),
  rabbitmq: configurationRows({ uri: 'amqp://127.0.0.1:1' }),
  amqp: configurationRows({ uri: 'amqp://127.0.0.1:1' }),
  outbox: configurationRows({ maxAttempts: 4 }),
  tenant: configurationRows({ demoOrganizationId: 'demo' }),
  zitadel: configurationRows({
    issuer: 'http://zitadel.invalid',
    clientId: 'spec-client',
    pat: 'spec-pat',
    redirectUri: 'http://app.invalid/callback',
    postLogoutRedirectUri: 'http://app.invalid/',
    actionSigningKey: 'spec-signing-key',
  }),
  lifecycle: configurationRows({ sweepIntervalMs: 60_000 }),
});

const seed = () => Effect.succeed([]);

describe('the auth shell', () => {
  it('composes from its configuration without dialling anything', async () => {
    const layer = await Effect.runPromise(
      authComposition({ seed })(CONFIGURATION),
    );

    expect(Layer.isLayer(layer)).toBe(true);
  });

  it('refuses a configuration with no identity provider, at boot', async () => {
    const exit = await Effect.runPromiseExit(
      authComposition({ seed })(
        fleetConfigurationOf({ ...CONFIGURATION.plain, zitadel: [] }),
      ),
    );

    expect(exit._tag).toBe('Failure');
  });

  it('offers the booted composition and the routes as layers', () => {
    expect(Layer.isLayer(makeAppLayer({ seed }))).toBe(true);
    expect(Layer.isLayer(router)).toBe(true);
  });

  it('signs for the audience its own verifiers expect', () => {
    expect(JWT_ISSUER).toBeTypeOf('string');
    expect(JWT_AUDIENCE).toBeTypeOf('string');
  });

  it('builds the identity provider from the session store and the accounts', async () => {
    const provider = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* IdentityProviderTag;
      }).pipe(
        Effect.provide(
          IdentityProviderLayer.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(SessionStoreTag, {} as never),
                Layer.succeed(AccountRepositoryTag, {} as never),
              ),
            ),
          ),
        ),
      ),
    );

    expect(provider).toBeDefined();
  });
});

interface Logged {
  readonly level: string;
  readonly message: unknown;
  readonly annotations: Record<string, unknown>;
}

const rebuildWith = async (
  rows: Record<string, unknown>[],
  unreadable = false,
): Promise<Logged[]> => {
  const fake = makeFakeMongoDb({ [ORGANIZATION_COLLECTION]: rows });
  await Effect.runPromise(ensureOutboxIndexes(fake.db as Db));
  if (unreadable) fake.failOn('find', new Error('network down'));
  const logged: Logged[] = [];
  await Effect.runPromise(
    rebuildAndReport.pipe(
      Effect.provideService(MongoDatabaseTag, fake.db as never),
      Effect.provideService(EventBusTag, makeRecordingEventBus()),
      Effect.provideService(EventSourceTag, 'auth'),
      Effect.provide(
        Logger.layer([
          Logger.make(({ logLevel, message, fiber }) => {
            logged.push({
              level: logLevel,
              message,
              annotations: {
                ...fiber.getRef(References.CurrentLogAnnotations),
              },
            });
          }),
        ]),
      ),
      Effect.provideService(References.MinimumLogLevel, 'All'),
    ),
  );
  return logged;
};

describe('the organization rebuild, at its fork site', () => {
  it('logs what it announced, and warns of an organization it could not', async () => {
    const logged = await rebuildWith([
      {
        id: 'org-1',
        name: 'Demo Vendor',
        updatedAt: new Date('2026-10-23T10:00:00.000Z'),
      },
      { id: 'org-2' },
    ]);

    expect(logged.map(entry => entry.level)).toEqual(['Warn', 'Info']);
    expect(logged[0]?.annotations).toEqual({ unannounceable: 1 });
    expect(logged[1]?.annotations).toMatchObject({
      announced: 1,
      unannounceable: 1,
    });
  });

  it('warns of nothing when every organization announces', async () => {
    const logged = await rebuildWith([]);

    expect(logged.map(entry => entry.level)).toEqual(['Info']);
  });

  it('logs a walk that could not read the store, and does not fail', async () => {
    const logged = await rebuildWith([], true);

    expect(logged).toEqual([
      expect.objectContaining({
        level: 'Error',
        annotations: expect.objectContaining({ code: 'unavailable' }),
      }),
    ]);
  });

  it('forks the walk past boot', async () => {
    const fake = makeFakeMongoDb();
    await Effect.runPromise(ensureOutboxIndexes(fake.db as Db));

    const finished = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* startOrganizationRebuild;
        yield* Fiber.join(fiber);
        return true;
      }).pipe(
        Effect.provideService(MongoDatabaseTag, fake.db as never),
        Effect.provideService(EventBusTag, makeRecordingEventBus()),
        Effect.provideService(EventSourceTag, 'auth'),
      ),
    );

    expect(finished).toBe(true);
  });
});

describe('a seed shortfall, at the fork site that ran the seed', () => {
  it('is logged as a warning naming the record, never the failure text', async () => {
    const logged: Logged[] = [];
    await Effect.runPromise(
      reportSeedShortfalls([
        {
          record: { email: 'alan@example.test' },
          failure: new Error('provider down'),
        },
      ]).pipe(
        Effect.provide(
          Logger.layer([
            Logger.make(({ logLevel, message, fiber }) => {
              logged.push({
                level: logLevel,
                message,
                annotations: {
                  ...fiber.getRef(References.CurrentLogAnnotations),
                },
              });
            }),
          ]),
        ),
        Effect.provideService(References.MinimumLogLevel, 'All'),
      ),
    );

    expect(logged).toEqual([
      expect.objectContaining({
        level: 'Warn',
        annotations: expect.objectContaining({ email: 'alan@example.test' }),
      }),
    ]);
    expect(JSON.stringify(logged)).not.toContain('provider down');
  });
});
