import type { TransitionalFailure } from '@entifix/core';
import { Context, type Effect } from 'effect';

/**
 * One step's inputs: a body per call, and for a step that crosses into
 * per-organization storage the organization each call is for.
 */
export interface SagaCallInput {
  readonly organizationId?: string;
  readonly body: unknown;
}

/** A flow's inputs, keyed by step id. */
export type SagaInputs = Readonly<Record<string, readonly SagaCallInput[]>>;

/**
 * How a flow the coordinator ran ended, as its starter needs to tell it.
 *
 * - `completed` — every step ran (`201`).
 * - `compensated` — a step was refused before the pivot and everything taken
 *   was given back (`409`). An outcome the caller can act on, not an error.
 * - `failed` — stranded past the pivot, or the coordinator itself failed.
 *
 * `result` is the coordinator's own answer, which names the step that refused.
 */
export type SagaStartOutcome =
  | { readonly _tag: 'completed'; readonly result: unknown }
  | { readonly _tag: 'compensated'; readonly result: unknown }
  | {
      readonly _tag: 'failed';
      readonly status: number;
      readonly result: unknown;
    };

/**
 * Starts a flow on the saga coordinator.
 *
 * A port, because three hosts start flows — the storefront's checkout, the
 * till's counter sale and an order's cancellation — and each used to write the
 * same request by hand. What the request carries (the coordinator's inbound
 * crossing token, its address) is composition's to supply; what a caller
 * decides is only which flow, with which inputs.
 */
export interface SagaStarter {
  /**
   * Starts `definition` under `idempotencyKey`: the coordinator answers a
   * repeated key with what the first start decided (ADR 0068), so a caller
   * whose start is retried — or a cancellation asked for twice — runs one flow.
   */
  readonly start: (
    definition: string,
    inputs: SagaInputs,
    idempotencyKey: string,
  ) => Effect.Effect<SagaStartOutcome, TransitionalFailure>;
}

export class SagaStarterTag extends Context.Service<
  SagaStarterTag,
  SagaStarter
>()('SagaStarterTag') {}

/** The outcome a coordinator's HTTP status means. */
export const sagaOutcomeFor = (
  status: number,
  result: unknown,
): SagaStartOutcome =>
  status === 201
    ? { _tag: 'completed', result }
    : status === 409
      ? { _tag: 'compensated', result }
      : { _tag: 'failed', status, result };
