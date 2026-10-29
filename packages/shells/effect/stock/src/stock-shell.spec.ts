import { generateKeyPairSync } from 'node:crypto';

import { ShutdownRegistryTag } from '@entifix/business';
import { Unavailable } from '@entifix/core';
import {
  type ExpirySweep,
  type StockLedger,
  StockLedgerTag,
} from '@r10c/business-ts-stock-management';
import {
  configurationRows,
  fleetConfigurationOf,
} from '@r10c/shells-effect-service';
import { Effect, Layer, Logger, References } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  makeAppLayer,
  router,
  startReservationSweep,
  stockComposition,
  sweepExpiredHolds,
} from './index.js';

const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

const CONFIGURATION = fleetConfigurationOf({
  jwt: configurationRows({
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    keyId: 'spec-key',
  }),
  service: configurationRows({ token: 'spec-crossing-token' }),
  mongo: configurationRows({
    uri: 'mongodb://127.0.0.1:1/?directConnection=true',
  }),
  tenant: configurationRows({
    dbPrefix: 'stock_',
    demoOrganizationId: 'demo',
  }),
  reservation: configurationRows({ ttlSeconds: 900 }),
  idempotency: configurationRows({ retentionMs: 60_000 }),
});

const seed = () => Effect.void;

describe('the stock shell', () => {
  it('composes from its configuration without dialling anything', async () => {
    const layer = await Effect.runPromise(
      stockComposition({ seed })(CONFIGURATION),
    );

    expect(Layer.isLayer(layer)).toBe(true);
  });

  it('refuses a configuration with no hold lifetime, at boot', async () => {
    const exit = await Effect.runPromiseExit(
      stockComposition({ seed })(
        fleetConfigurationOf({ ...CONFIGURATION.plain, reservation: [] }),
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

const ledgerThat = (
  releaseExpired: StockLedger['releaseExpired'],
): StockLedger => ({ releaseExpired }) as unknown as StockLedger;

const sweepWith = async (ledger: StockLedger): Promise<Logged[]> => {
  const logged: Logged[] = [];
  await Effect.runPromise(
    sweepExpiredHolds.pipe(
      Effect.provideService(StockLedgerTag, ledger),
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

describe('one reaper pass', () => {
  it('logs each hold it could not release by code, and what it released', async () => {
    const sweep: ExpirySweep = {
      released: 2,
      failed: [
        {
          database: 'stock_a',
          reservationId: 'r-1',
          failure: new Unavailable({ dependency: 'mongo' }),
        },
      ],
    };

    const logged = await sweepWith(ledgerThat(() => Effect.succeed(sweep)));

    expect(logged.map(entry => entry.level)).toEqual(['Error', 'Debug']);
    expect(logged[0]?.annotations).toEqual({
      database: 'stock_a',
      reservationId: 'r-1',
      code: 'unavailable',
      category: 'unavailable',
    });
    expect(logged[1]?.annotations).toEqual({ released: 2 });
  });

  it('logs nothing for a pass with nothing to do', async () => {
    expect(
      await sweepWith(
        ledgerThat(() => Effect.succeed({ released: 0, failed: [] })),
      ),
    ).toEqual([]);
  });

  it('logs a pass that could not run, and does not fail', async () => {
    const logged = await sweepWith(
      ledgerThat(() => Effect.fail(new Unavailable({}))),
    );

    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({
      level: 'Error',
      annotations: { code: 'unavailable' },
    });
  });
});

describe('the reaper daemon', () => {
  it('registers itself to stop after the handlers, and stops', async () => {
    const hooks: Array<{
      name: string;
      phase: string;
      run: Effect.Effect<unknown>;
    }> = [];

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* startReservationSweep;
        for (const hook of hooks) yield* hook.run;
      }).pipe(
        Effect.provideService(
          StockLedgerTag,
          ledgerThat(() => Effect.succeed({ released: 0, failed: [] })),
        ),
        Effect.provideService(ShutdownRegistryTag, {
          register: (hook: (typeof hooks)[number]) =>
            Effect.sync(() => {
              hooks.push(hook);
            }),
        } as never),
      ),
    );

    expect(hooks.map(hook => [hook.name, hook.phase])).toEqual([
      ['reservation-sweep', 'flush'],
    ]);
  });
});
