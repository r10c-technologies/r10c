import type { EntifixConnError } from '@r10c/entifix-ts-core';
import { Context, type Effect } from 'effect';

import type { SagaStepOutcome } from '../contracts/saga-definition';

/**
 * Where a saga instance is.
 *
 * `COMPENSATED` and `STRANDED` are deliberately different terminal states:
 * "failed and reversed" and "failed with something still held" are the two
 * outcomes an operator has to be able to tell apart, and a single `FAILED`
 * would make the second look like the first
 * ([ADR 0039](../../../../../../docs/adr/0039-multi-step-sagas-are-orchestrated.md)).
 */
export const SAGA_STATES = [
  'RUNNING',
  'COMPLETED',
  'COMPENSATING',
  'COMPENSATED',
  'STRANDED',
] as const;

export type SagaState = (typeof SAGA_STATES)[number];

/** One flow in progress, and what each of its steps returned. */
export interface SagaInstance {
  readonly sagaId: string;
  /** The {@link SagaDefinition}'s `name`. */
  readonly definition: string;
  readonly state: SagaState;
  /** The step being dispatched, or the last one dispatched. */
  readonly stepIndex: number;
  readonly outcomes: readonly SagaStepOutcome[];
  readonly error?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * The saga's own state, in the `saga` store.
 *
 * A saga instance is a transaction's state with steps in it, so it belongs in
 * the store that already holds transaction state — no new store, and the
 * `transaction` slice keeps `domains: []`, because orchestration is a mechanism
 * rather than a business domain (ADR 0039).
 */
export interface SagaStore {
  start(
    instance: Omit<SagaInstance, 'updatedAt'>,
  ): Effect.Effect<void, EntifixConnError>;
  /**
   * Persist that a step is about to be dispatched.
   *
   * ⚠️ **Before the dispatch, never after.** ADR 0028's rule extended from
   * events to commands: a coordinator that marks a step in flight only after
   * calling has the dual write that record exists to close, with the same
   * consequence — a crash between the two leaves a step that either ran twice
   * or never ran, and the record says the opposite of the truth.
   */
  beginStep(
    sagaId: string,
    stepIndex: number,
  ): Effect.Effect<void, EntifixConnError>;
  recordOutcome(
    sagaId: string,
    outcome: SagaStepOutcome,
  ): Effect.Effect<void, EntifixConnError>;
  settle(
    sagaId: string,
    state: SagaState,
    error?: string,
  ): Effect.Effect<void, EntifixConnError>;
  get(
    sagaId: string,
  ): Effect.Effect<SagaInstance | undefined, EntifixConnError>;
  /** Instances left `RUNNING` or `COMPENSATING` past a deadline, for the sweep. */
  findStale(
    olderThanMs: number,
  ): Effect.Effect<readonly SagaInstance[], EntifixConnError>;
}

export class SagaStoreTag extends Context.Tag('SagaStoreTag')<
  SagaStoreTag,
  SagaStore
>() {}
