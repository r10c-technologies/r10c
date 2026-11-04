import {
  decodeProblem,
  type EntifixFailure,
  PROBLEM_CONTENT_TYPE,
  ProtocolFailure,
  UpstreamUnavailable,
} from '@entifix/core';
import { FlowAccepted } from '@entifix/transactions';
import { Context, Effect, Schema } from 'effect';

/**
 * Starts a flow on the coordinator and answers what to follow
 * ([ADR 0066](../../../../../docs/adr/0066-flows-run-on-a-durable-workflow-engine.md),
 * [ADR 0073](../../../../../docs/adr/0073-the-optimistic-contract-settles-by-push-and-catches-up-from-flow-status.md)).
 *
 * A port, because three hosts start flows — the storefront's checkout, the
 * till's counter sale and an order's cancellation — and none of them waits for
 * the outcome: the coordinator composes, validates and starts the slip, then
 * answers `202` with the flow's id and its status and stream links. What the
 * request carries (the coordinator's inbound crossing token, its address) is
 * composition's to supply; what a caller decides is which recipe, with which
 * start input.
 */
export interface FlowStarter {
  /**
   * Starts `recipe` under `idempotencyKey`: a repeated key names the flow the
   * first start began (ADR 0068), so a retried start — or a cancellation asked
   * for twice — runs one flow. A refusal to compose (an input the recipe does
   * not accept, a vendor not provisioned for a step) is the coordinator's
   * typed failure; a coordinator that cannot be reached is
   * `UpstreamUnavailable`.
   */
  readonly start: (
    recipe: string,
    input: unknown,
    idempotencyKey: string,
  ) => Effect.Effect<FlowAccepted, EntifixFailure>;
}

export class FlowStarterTag extends Context.Service<
  FlowStarterTag,
  FlowStarter
>()('FlowStarterTag') {}

/** The coordinator every flow start reaches, named in an unreachable failure. */
export const FLOW_COORDINATOR = 'transaction-service';

const decodeAccepted = Schema.decodeUnknownEffect(
  Schema.Struct({
    meta: Schema.Struct({ type: Schema.Literal('flowAccepted') }),
    data: FlowAccepted,
  }),
);

/**
 * What a coordinator's answer means to its starter: a `202` carrying a
 * `flowAccepted` envelope is the flow; a problem body is the refusal it
 * names; anything else is a coordinator speaking another protocol.
 */
export const flowStartOutcome = (answer: {
  readonly status: number;
  readonly contentType: string | undefined;
  readonly body: unknown;
}): Effect.Effect<FlowAccepted, EntifixFailure> => {
  if (answer.status === 202)
    return decodeAccepted(answer.body).pipe(
      Effect.map(envelope => envelope.data),
      Effect.mapError(
        () =>
          new ProtocolFailure({
            reason: `${FLOW_COORDINATOR} answered 202 without a flowAccepted envelope`,
            upstreamStatus: 202,
          }),
      ),
    );
  if (answer.contentType?.startsWith(PROBLEM_CONTENT_TYPE) === true)
    return Effect.fail(decodeProblem(answer.body, answer.status));
  return Effect.fail(
    new ProtocolFailure({
      reason: `${FLOW_COORDINATOR} answered ${String(answer.status)} without a problem body`,
      upstreamStatus: answer.status,
    }),
  );
};

/** A coordinator that could not be reached at all. */
export const coordinatorUnreachable = (): EntifixFailure =>
  new UpstreamUnavailable({ upstream: FLOW_COORDINATOR });
