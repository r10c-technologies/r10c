import { generateKeyPairSync } from 'node:crypto';

import type { ServiceCrossingTokenTag } from '@entifix/service-shell';
import type { FlowEngineTag } from '@entifix/transactions';
import {
  flowParticipants,
  PARTICIPANT_DIALS,
  participantDialKey,
} from '@r10c/shells-effect-flow-catalog';
import {
  configurationRows,
  fleetConfigurationOf,
} from '@r10c/shells-effect-service';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  makeAppLayer,
  makeRunnerLayer,
  runnerComposition,
  transactionComposition,
} from './index.js';

const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

const CONFIGURATION = fleetConfigurationOf({
  jwt: configurationRows({
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    keyId: 'spec-key',
  }),
  service: configurationRows({ token: 'spec-crossing-token' }),
  amqp: configurationRows({ uri: 'amqp://127.0.0.1:1' }),
  rabbitmq: configurationRows({ uri: 'amqp://127.0.0.1:1' }),
  participant: configurationRows({
    stockUrl: 'http://stock.invalid/api',
    stockToken: 'stock-token',
    fulfilmentUrl: 'http://fulfilment.invalid/api',
    fulfilmentToken: 'fulfilment-token',
    orderUrl: 'http://order.invalid/api',
    orderToken: 'order-token',
    paymentUrl: 'http://payment.invalid/api',
    paymentToken: 'payment-token',
  }),
  workflow: configurationRows({
    url: 'postgres://postgres:postgres@127.0.0.1:1/workflow',
    runnerHost: '127.0.0.1',
  }),
  flow: configurationRows({ concurrency: 4 }),
  delivery: configurationRows({
    awaitDeliveryTimeout: 1_209_600_000,
    awaitReturnTimeout: 2_592_000_000,
  }),
  marketplace: configurationRows({ url: 'http://marketplace.invalid/api' }),
  outbox: configurationRows({ maxAttempts: 5 }),
  breaker: flowParticipants().flatMap(participant =>
    PARTICIPANT_DIALS.map(dial => ({
      key: participantDialKey(participant, dial),
      value:
        dial === 'windowType'
          ? 'count'
          : dial === 'forcedState'
            ? 'closed'
            : '10',
    })),
  ),
});

const REPLICA_0 = { servicePort: 3103, replica: 0 };

const failureOf = async (effect: Effect.Effect<unknown, unknown>) => {
  const exit = await Effect.runPromiseExit(effect);
  return exit._tag === 'Failure' ? String(exit.cause) : 'succeeded';
};

describe('the transaction shell', () => {
  it('composes from its configuration without dialling anything', async () => {
    const replica0 = await Effect.runPromise(
      transactionComposition(REPLICA_0)(CONFIGURATION),
    );
    const replica1 = await Effect.runPromise(
      runnerComposition({ servicePort: 3103, replica: 1 })(CONFIGURATION),
    );

    expect(Layer.isLayer(replica0)).toBe(true);
    expect(Layer.isLayer(replica1)).toBe(true);
  });

  // The routes read these from the composition's *output*. Provided into the
  // engine and not merged, they vanish from it: every start answers 500 while
  // the layer still builds — measured on the live lab, invisible to the build.
  it('exposes what the start routes read, not only what the engine does', () => {
    type Exposed = Layer.Success<
      Effect.Success<ReturnType<ReturnType<typeof transactionComposition>>>
    >;
    const routesRead: [ServiceCrossingTokenTag, FlowEngineTag] extends [
      Exposed,
      Exposed,
    ]
      ? true
      : false = true;

    expect(routesRead).toBe(true);
  });

  /** A participant on entifix's defaults would be sized for nobody, silently. */
  it('refuses, at boot, a participant missing a dial, naming the row', async () => {
    const withoutOne = fleetConfigurationOf({
      ...CONFIGURATION.plain,
      breaker: (CONFIGURATION.plain['breaker'] ?? []).filter(
        row => row.key !== 'payment-service.stepBoundMs',
      ),
    });

    expect(
      await failureOf(transactionComposition(REPLICA_0)(withoutOne)),
    ).toContain('payment-service.stepBoundMs');
    expect(await failureOf(runnerComposition(REPLICA_0)(withoutOne))).toContain(
      'payment-service.stepBoundMs',
    );
  });

  it('refuses a configuration that names no participant, at boot', async () => {
    const exit = await Effect.runPromiseExit(
      transactionComposition(REPLICA_0)(
        fleetConfigurationOf({ ...CONFIGURATION.plain, participant: [] }),
      ),
    );

    expect(exit._tag).toBe('Failure');
  });

  it('offers the booted composition as a layer', () => {
    expect(Layer.isLayer(makeAppLayer(3103))).toBe(true);
    expect(Layer.isLayer(makeRunnerLayer({ ...REPLICA_0, replica: 1 }))).toBe(
      true,
    );
  });
});
