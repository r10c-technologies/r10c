import {
  audienceAdmits,
  type AudienceEntry,
  type AudienceRecipient,
  type DomainEvent,
  Invalid,
  registerMessage,
  type StoreFault,
} from '@entifix/core';
import {
  FlowEventData,
  type FlowEventName,
  FlowStatusBody,
} from '@entifix/transactions';
import { Context, Effect, Schema } from 'effect';

/** Where a flow stands, in the vocabulary the browser's catch-up reads. */
export type FlowState = FlowStatusBody['state'];

/** A typed failure as a flow event carries it: its catalog `code`, and its category. */
export type FlowFailure = NonNullable<FlowStatusBody['failure']>;

/**
 * One record per flow in the `flow-status` store — a projection of the
 * workflow journal, written from `flow.*` and never from the journal itself,
 * which is the engine's private storage
 * ([ADR 0072](../../../../../docs/adr/0072-the-realtime-slice-flow-status-and-the-edge.md)).
 *
 * `audience` is the flow event's own, so a read is answered to exactly whom the
 * event would have been pushed to. `capabilityDigest` is the SHA-256 digest of
 * the flow capability an anonymous holder presents — the digest only, never the
 * nonce, so the store holds nothing that can perform the read it guards.
 */
export interface FlowStatusRecord {
  readonly flowId: string;
  readonly definition: string;
  readonly slipVersion: number;
  readonly state: FlowState;
  readonly step?: string;
  readonly failure?: FlowFailure;
  readonly audience: readonly AudienceEntry[];
  readonly capabilityDigest?: string;
  /** The event's version: the step ordinal, so an older one never overwrites. */
  readonly version: number;
  readonly updatedAt: Date;
}

/** Which consumer took which message, for the inbox claim the apply runs under. */
export interface FlowStatusClaim {
  readonly consumer: string;
  readonly eventId: string;
}

/**
 * What one apply did: wrote the record, found a newer version already there,
 * or found this very message already claimed.
 */
export type FlowStatusApplied = 'applied' | 'stale' | 'duplicate';

/**
 * The `flow-status` store's port. `apply` is version-guarded and claims the
 * message in the same write, so a redelivery and an out-of-order delivery are
 * both answered without a read-then-write race.
 */
export interface FlowStatusStore {
  readonly read: (
    flowId: string,
  ) => Effect.Effect<FlowStatusRecord | undefined, StoreFault>;
  readonly readMany: (
    flowIds: readonly string[],
  ) => Effect.Effect<readonly FlowStatusRecord[], StoreFault>;
  readonly apply: (
    record: FlowStatusRecord,
    claim: FlowStatusClaim,
  ) => Effect.Effect<FlowStatusApplied, StoreFault>;
}

export class FlowStatusStoreTag extends Context.Service<
  FlowStatusStoreTag,
  FlowStatusStore
>()('@r10c/business-ts-flow-contracts/FlowStatusStore') {}

/** What each flow event says about where the flow stands. */
export const FLOW_EVENT_STATES: Readonly<Record<FlowEventName, FlowState>> = {
  'flow.started': 'running',
  'flow.suspended': 'suspended',
  'flow.completed': 'completed',
  'flow.failed': 'failed',
};

const isFlowEventName = (name: string): name is FlowEventName =>
  Object.hasOwn(FLOW_EVENT_STATES, name);

const malformed = (detail: string) =>
  new Invalid({ errors: [{ pointer: '/data', detail, code: 'malformed' }] });

/**
 * The record a flow event projects to. The capability digest is read off the
 * audience's flow entry, where the slip author put it; the engine's own
 * `{kind: 'flow', id}` entry carries none and admits nobody by itself.
 */
export const flowStatusFromEvent = (
  event: DomainEvent,
): Effect.Effect<FlowStatusRecord, Invalid> =>
  Effect.gen(function* () {
    if (!isFlowEventName(event.name))
      return yield* malformed(`'${event.name}' is not a flow event`);
    if (event.version === undefined)
      return yield* malformed('a flow event carries its step ordinal');
    const data = yield* Schema.decodeUnknownEffect(FlowEventData)(
      event.data,
    ).pipe(Effect.mapError(error => malformed(error.message)));
    const audience = event.audience ?? [];
    const digest = audience.find(
      entry => entry.kind === 'flow' && entry.digest !== undefined,
    )?.digest;
    return {
      flowId: data.flowId,
      definition: data.definition,
      slipVersion: data.slipVersion,
      state: FLOW_EVENT_STATES[event.name],
      ...(data.step === undefined ? {} : { step: data.step }),
      ...(data.failure === undefined ? {} : { failure: data.failure }),
      audience,
      ...(digest === undefined ? {} : { capabilityDigest: digest }),
      version: event.version,
      updatedAt: new Date(event.at),
    };
  });

/**
 * Whether `recipient` may read `record`: the same rule the stream applies to
 * the flow's events, so a status read can never answer someone the push would
 * not have reached. It fails closed — a record with no audience is read by
 * nobody.
 */
export const admitsFlowReader = (
  record: FlowStatusRecord,
  recipient: AudienceRecipient,
): boolean => audienceAdmits(record.audience, recipient);

/** The body `GET /api/realtime/flow/:id` answers, as the browser decodes it. */
export const toFlowStatusBody = (record: FlowStatusRecord): FlowStatusBody => ({
  flowId: record.flowId,
  state: record.state,
  ...(record.step === undefined ? {} : { step: record.step }),
  ...(record.failure === undefined ? {} : { failure: record.failure }),
});

/**
 * The envelope type of `GET /api/realtime/flow?ids=…`: every flow the caller
 * may read among those named, each as a `flowStatus` body. Registered so a
 * reader decodes it through the codec rather than casting it.
 */
export const FLOW_STATUS_LIST = 'flowStatusList';

registerMessage(FLOW_STATUS_LIST, Schema.Array(FlowStatusBody));
