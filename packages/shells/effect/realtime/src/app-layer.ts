import {
  fleetBusLayer,
  type FleetConfiguration,
  fleetSecurityLayer,
  fleetSingleMongoLayer,
  makeFleetServiceLayer,
} from '@r10c/shells-effect-service';
import { Effect, Layer } from 'effect';

import { startPushSubscriptions } from './push-subscriptions.js';
import { RealtimePushLayer } from './realtime-push.js';

const SERVICE_NAME = 'realtime-service';

/**
 * The SSE adapter's dials, read from configuration rather than written as
 * constants (ADR 0072): the jittered `retry:` range a drain spreads its
 * reconnects over, how long before the token's `exp` a stream asks to
 * reauthenticate, and how long a shutdown waits for the last frames.
 */
export const readPushDials = ({ store }: FleetConfiguration) =>
  Effect.gen(function* () {
    const realtime = store.in('realtime');
    return {
      retryMs: {
        min: yield* realtime.getNumber('retryMinMs'),
        max: yield* realtime.getNumber('retryMaxMs'),
      },
      reauthMarginMs: yield* realtime.getNumber('reauthMarginMs'),
      drainWindowMs: yield* realtime.getNumber('drainWindowMs'),
    };
  });

/**
 * The `realtime` slice's composition, mounted by realtime-service alone
 * (ADR 0064): the push hub every replica holds and the broadcast queues that
 * feed it.
 *
 * ⚠️ **AMQP is dialled at boot and probed**, like every consumer in the fleet:
 * a broker that is merely slow must hold the readiness probe red rather than
 * exit the process.
 */
export const realtimeComposition = (configuration: FleetConfiguration) =>
  Effect.gen(function* () {
    const dials = yield* readPushDials(configuration);

    const connections = Layer.mergeAll(
      yield* fleetSingleMongoLayer(configuration, ['flow-status']),
      yield* fleetBusLayer(configuration),
      yield* fleetSecurityLayer(configuration),
    );

    const push = Layer.provideMerge(RealtimePushLayer({ dials }), connections);

    return Layer.provideMerge(
      Layer.effectDiscard(startPushSubscriptions),
      push,
    );
  });

/** The composition, booted against the configuration config-service serves. */
export const makeAppLayer = () =>
  makeFleetServiceLayer(SERVICE_NAME, realtimeComposition);
