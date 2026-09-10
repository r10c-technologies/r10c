import type { EntifixConnError } from '@r10c/entifix-ts-core';
import { Context, type Effect } from 'effect';

import type {
  SagaInputs,
  SagaStepOutcome,
} from '../contracts/saga-definition';

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
  /**
   * What the caller supplied, kept so a **different process** can finish this
   * flow.
   *
   * ⚠️ This is the member that makes the instance a resumable record rather
   * than a report on one. Without it a resumed walk knows which step is next
   * and has nothing to dispatch it with: a fan-out step's cardinality is its
   * input's length, and a body template resolves against `inputs` before it
   * resolves against earlier outcomes
   * ([ADR 0055](../../../../../../docs/adr/0055-a-coordinator-resumes-from-its-own-record.md)).
   */
  readonly inputs: SagaInputs;
  /**
   * How many times a sweep has picked this instance up, which is the ceiling
   * that stops a resume loop.
   *
   * It plays the part ADR 0030's `attempts` plays on an outbox entry, on the
   * record that already exists rather than on a second one beside it. Past the
   * ceiling the instance is settled `STRANDED` and logged — surfaced rather
   * than retried forever, because a coordinator spinning on a permanent failure
   * is how a customer's money stays captured with nobody told.
   */
  readonly resumeAttempts: number;
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
  /**
   * Take ownership of a stale instance, or answer `undefined`.
   *
   * ⚠️ **A claim, not a read**, and it is what makes the sweep safe to run in
   * more than one process: the same conditional write that increments
   * `resumeAttempts` also re-stamps `updatedAt`, so an instance already picked
   * up is no longer stale and the second sweeper gets nothing. Reading and then
   * resuming would have two coordinators dispatching one flow — survivable,
   * because every participant claims the command id, but it would double every
   * call and make the attempt ceiling meaningless.
   *
   * Re-stamping is also what stops *this* sweep's next tick finding the
   * instance it is still working on.
   */
  claimForResume(
    sagaId: string,
    olderThanMs: number,
  ): Effect.Effect<SagaInstance | undefined, EntifixConnError>;
  /** Mark one step's calls as given back, so a resumed unwind skips them. */
  markCompensated(
    sagaId: string,
    stepId: string,
  ): Effect.Effect<void, EntifixConnError>;
}

export class SagaStoreTag extends Context.Tag('SagaStoreTag')<
  SagaStoreTag,
  SagaStore
>() {}
