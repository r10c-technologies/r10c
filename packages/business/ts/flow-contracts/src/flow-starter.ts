import {
  decodeProblem,
  Failure,
  PROBLEM_CONTENT_TYPE,
  ProtocolFailure,
  type TechnicalFailure,
  UpstreamUnavailable,
} from '@entifix/core';
import { FlowAccepted } from '@entifix/transactions';
import { Context, Effect, Schema } from 'effect';

export { FlowAccepted } from '@entifix/transactions';

/**
 * The coordinator refused to start a flow: the input was not one the recipe
 * accepts, or a vendor in it is not provisioned for a step. The coordinator's
 * own `code` travels with it, so a caller can name the refusal without
 * declaring every failure a composition can raise — which no caller, typed by
 * the routes it serves, could keep in step with the recipes.
 */
export class FlowNotStarted extends Failure.declined<FlowNotStarted>()(
  'FlowNotStarted',
  'flowNotStarted',
  { refusal: Schema.String },
  { message: ({ refusal }) => `the coordinator refused to start: ${refusal}` },
) {}

/** Why a flow did not start: refused, or the coordinator could not answer. */
export type FlowStartFailure = FlowNotStarted | TechnicalFailure;

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
  ) => Effect.Effect<FlowAccepted, FlowStartFailure>;
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
}): Effect.Effect<FlowAccepted, FlowStartFailure> => {
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
  if (answer.contentType?.startsWith(PROBLEM_CONTENT_TYPE) === true) {
    const failure = decodeProblem(answer.body, answer.status);
    return Effect.fail(
      Failure.isFamily('technical')(failure)
        ? (failure as TechnicalFailure)
        : new FlowNotStarted({ refusal: failure.code }),
    );
  }
  return Effect.fail(
    new ProtocolFailure({
      reason: `${FLOW_COORDINATOR} answered ${String(answer.status)} without a problem body`,
      upstreamStatus: answer.status,
    }),
  );
};

/** A coordinator that could not be reached at all. */
export const coordinatorUnreachable = (): TechnicalFailure =>
  new UpstreamUnavailable({ upstream: FLOW_COORDINATOR });
