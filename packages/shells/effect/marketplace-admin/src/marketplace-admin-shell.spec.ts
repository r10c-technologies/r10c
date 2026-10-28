import { generateKeyPairSync } from 'node:crypto';

import {
  EntityRepositoryFactoryTag,
  TenantDirectoryTag,
} from '@entifix/business';
import { Unavailable } from '@entifix/core';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import { EventSourceTag } from '@entifix/transactions';
import { OfferingCatalogTag } from '@r10c/business-ts-product-configuration-management';
import {
  configurationRows,
  fleetConfigurationOf,
} from '@r10c/shells-effect-service';
import { Effect, Fiber, Layer, Logger, References } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  makeAppLayer,
  marketplaceAdminComposition,
  rebuildAndReport,
  router,
  startRebuildWalk,
} from './index.js';

const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

const CONFIGURATION = fleetConfigurationOf({
  jwt: configurationRows({
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    keyId: 'spec-key',
  }),
  mongo: configurationRows({
    uri: 'mongodb://127.0.0.1:1/?directConnection=true',
  }),
  tenant: configurationRows({
    dbPrefix: 'tenant_',
    demoOrganizationId: 'demo',
  }),
  redis: configurationRows({ uri: 'redis://127.0.0.1:1' }),
  rabbitmq: configurationRows({ uri: 'amqp://127.0.0.1:1' }),
  amqp: configurationRows({ uri: 'amqp://127.0.0.1:1' }),
  outbox: configurationRows({ maxAttempts: 4 }),
});

const seed = () => Effect.void;

describe('the marketplace-admin shell', () => {
  it('composes from its configuration without dialling anything', async () => {
    const layer = await Effect.runPromise(
      marketplaceAdminComposition({ seed })(CONFIGURATION),
    );

    expect(Layer.isLayer(layer)).toBe(true);
  });

  it('refuses a configuration with no lock store, at boot', async () => {
    const exit = await Effect.runPromiseExit(
      marketplaceAdminComposition({ seed })(
        fleetConfigurationOf({ ...CONFIGURATION.plain, redis: [] }),
      ),
    );

    expect(exit._tag).toBe('Failure');
  });

  it('offers the booted composition and the routes as layers', () => {
    expect(Layer.isLayer(makeAppLayer({ seed }))).toBe(true);
    expect(Layer.isLayer(router)).toBe(true);
  });
});

interface Logged {
  readonly level: string;
  readonly message: unknown;
  readonly annotations: Record<string, unknown>;
}

const directoryOf = (organizations: readonly string[]) =>
  Layer.succeed(TenantDirectoryTag, {
    list: () =>
      Effect.succeed(
        organizations.map(organizationId => ({
          organizationId,
          handle: undefined,
        })),
      ),
  } as never);

const walkWith = async (
  directory: Layer.Layer<TenantDirectoryTag>,
  storesDown = false,
): Promise<Logged[]> => {
  const logged: Logged[] = [];
  const repositories = Layer.succeed(EntityRepositoryFactoryTag, {
    for: () =>
      storesDown
        ? Effect.fail(new Unavailable({ dependency: 'mongo' }))
        : Effect.succeed(makeInMemoryEntityRepository([])),
  } as never);
  await Effect.runPromise(
    rebuildAndReport('marketplace-admin').pipe(
      Effect.provide(
        Layer.mergeAll(
          directory,
          repositories,
          Layer.succeed(OfferingCatalogTag, {
            commitTransition: () => Effect.die('unused'),
            reannounce: () => Effect.die('unused'),
          } as never),
        ),
      ),
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

describe('the rebuild walk, at its fork site', () => {
  it('logs each organization it rebuilt', async () => {
    const logged = await walkWith(directoryOf(['acme', 'globex']));

    expect(
      logged.map(entry => [entry.level, entry.annotations['organizationId']]),
    ).toEqual([
      ['Info', 'acme'],
      ['Info', 'globex'],
    ]);
    expect(logged[0]?.annotations).toMatchObject({ announced: 0 });
  });

  it('logs each organization it could not rebuild, by code', async () => {
    const logged = await walkWith(directoryOf(['acme']), true);

    expect(logged).toEqual([
      expect.objectContaining({
        level: 'Error',
        annotations: expect.objectContaining({
          organizationId: 'acme',
          code: 'unavailable',
        }),
      }),
    ]);
  });

  it('logs a directory it could not read, and does not fail', async () => {
    const logged = await walkWith(
      Layer.succeed(TenantDirectoryTag, {
        list: () => Effect.fail(new Unavailable({})),
      } as never),
    );

    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      level: 'Error',
      annotations: { code: 'unavailable' },
    });
  });
});

describe('the rebuild walk daemon', () => {
  it('walks on its own fiber, as this slice', async () => {
    const walked = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* startRebuildWalk;
        yield* Fiber.join(fiber);
        return true;
      }).pipe(
        Effect.provideService(EventSourceTag, 'marketplace-admin'),
        Effect.provide(
          Layer.mergeAll(
            directoryOf([]),
            Layer.succeed(EntityRepositoryFactoryTag, {} as never),
            Layer.succeed(OfferingCatalogTag, {} as never),
          ),
        ),
      ),
    );

    expect(walked).toBe(true);
  });
});
