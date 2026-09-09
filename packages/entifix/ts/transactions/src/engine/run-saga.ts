import type { EntifixConnError } from '@r10c/entifix-ts-core';
import { Effect } from 'effect';

import {
  type SagaCall,
  type SagaCallOutcome,
  sagaCommandId,
  type SagaDefinition,
  type SagaStep,
  type SagaStepOutcome,
} from '../contracts/saga-definition';
import { SagaDispatcherTag } from '../ports/saga-dispatcher';
import { SagaStoreTag } from '../ports/saga-store';
import { resolveTemplate } from './resolve-template';

/**
 * What one step is given to work with — one element per call on a `fanOut` step,
 * exactly one otherwise.
 */
export interface SagaStepInput {
  /** The body to send. */
  readonly body?: unknown;
  /** ADR 0023's explicit organization, for a tenant-plane participant. */
  readonly organizationId?: string;
}

/** The inputs each step needs, keyed by step id, supplied by the caller. */
export type SagaInputs = Readonly<Record<string, readonly SagaStepInput[]>>;

export interface RunSagaOptions {
  readonly sagaId: string;
  readonly definition: SagaDefinition;
  readonly inputs: SagaInputs;
}

/** How a run ended. */
export interface SagaResult {
  readonly state: 'COMPLETED' | 'COMPENSATED' | 'STRANDED';
  readonly outcomes: readonly SagaStepOutcome[];
  readonly error?: string;
}

const inputsFor = (
  step: SagaStep,
  inputs: SagaInputs,
): readonly SagaStepInput[] => {
  const declared = inputs[step.id] ?? [];
  // A non-fan-out step makes exactly one call whether or not it was given an
  // input, so an absent entry is an empty body rather than a skipped step.
  return step.fanOut ? declared : [declared[0] ?? {}];
};

const dispatchCall = (
  step: SagaStep,
  call: SagaCall,
  sagaId: string,
  index: number,
  input: SagaStepInput,
  scope: Record<string, unknown>,
) =>
  Effect.gen(function* () {
    const dispatcher = yield* SagaDispatcherTag;
    return yield* dispatcher.dispatch({
      participant: step.participant,
      call: { method: call.method, path: resolveTemplate(call.path, scope) },
      commandId: sagaCommandId(
        sagaId,
        step.id,
        step.fanOut ? index : undefined,
      ),
      organizationId: input.organizationId,
      body:
        call.method === 'GET' || call.method === 'DELETE'
          ? undefined
          : input.body,
    });
  });

/**
 * Run one step: every call it makes, in order, stopping at the first refusal.
 *
 * Returns the calls that **succeeded** alongside the failure, because those are
 * exactly the calls a compensation has to undo — see {@link compensateStep}.
 */
const runStep = (
  step: SagaStep,
  sagaId: string,
  inputs: SagaInputs,
): Effect.Effect<
  { readonly calls: readonly SagaCallOutcome[]; readonly error?: string },
  EntifixConnError,
  SagaDispatcherTag
> =>
  Effect.gen(function* () {
    const elements = inputsFor(step, inputs);
    const calls: SagaCallOutcome[] = [];

    for (const [index, input] of elements.entries()) {
      const response = yield* dispatchCall(
        step,
        step.command,
        sagaId,
        index,
        input,
        { input: input.body },
      );

      if (!response.ok) {
        // A business refusal. The saga fails *forward* into compensation, and
        // the calls already recorded are the ones that have to come back.
        return {
          calls,
          error: `step '${step.id}' call ${String(index)} refused with ${String(
            response.status,
          )}`,
        };
      }

      calls.push({ index, status: response.status, body: response.body });
    }

    return { calls };
  });

/**
 * Undo one step — **one compensation per successful call**, never one per step.
 *
 * ⚠️ This is the whole reason an outcome is kept per fan-out element. Five lines
 * with three holds taken and the fourth refused must release exactly three:
 * compensating the step as a unit would either release nothing or attempt to
 * release two holds that were never taken
 * ([ADR 0052](../../../../../../docs/adr/0052-the-checkout-saga.md)).
 *
 * Never fails: a compensation's own failure is reported by the caller and must
 * not stop the compensations after it, for the reason ADR 0039 gives — a
 * stranded saga nobody is told about is the same as a lost one.
 */
const compensateStep = (
  step: SagaStep,
  sagaId: string,
  outcome: SagaStepOutcome,
): Effect.Effect<readonly string[], never, SagaDispatcherTag> =>
  Effect.gen(function* () {
    const compensation = step.compensation;
    if (!compensation) {
      return [];
    }

    const failures: string[] = [];
    // Reverse order: the last thing done is the first thing undone, which is
    // what a reader expects of a stack of effects and what keeps a future
    // ordering dependency from being an accident.
    for (const call of [...outcome.calls].reverse()) {
      const result = yield* dispatchCall(
        step,
        compensation,
        sagaId,
        call.index,
        {},
        { outcome: call.body },
      ).pipe(
        Effect.catchAll(error =>
          Effect.succeed({ ok: false, status: 0, body: error }),
        ),
        // A template that no longer matches the participant's response shape
        // throws rather than interpolating `undefined`; that is a defect, and
        // it is reported as a stranded compensation rather than crashing the
        // walk and leaving every later hold in place.
        Effect.catchAllDefect(defect =>
          Effect.succeed({ ok: false, status: 0, body: defect }),
        ),
      );

      if (!result.ok) {
        failures.push(
          `compensation for '${step.id}' call ${String(call.index)} failed: ${String(
            result.body,
          )}`,
        );
      }
    }

    return failures;
  });

/**
 * Walk a definition: dispatch each step, and on a refusal unwind every
 * compensatable step already taken.
 *
 * The state transition is persisted **before** each dispatch, so a crash leaves
 * a record that says what was actually attempted (ADR 0028, extended to
 * commands by ADR 0039).
 */
export const runSaga = (
  options: RunSagaOptions,
): Effect.Effect<
  SagaResult,
  EntifixConnError,
  SagaDispatcherTag | SagaStoreTag
> =>
  Effect.gen(function* () {
    const store = yield* SagaStoreTag;
    const { sagaId, definition, inputs } = options;
    const now = new Date().toISOString();

    yield* store.start({
      sagaId,
      definition: definition.name,
      state: 'RUNNING',
      stepIndex: 0,
      outcomes: [],
      createdAt: now,
    });

    // Step and outcome are kept **together**: looking the step back up by id
    // would introduce a not-found branch that cannot happen, and an unreachable
    // branch is a line nothing can ever prove correct.
    const taken: Array<{ step: SagaStep; outcome: SagaStepOutcome }> = [];
    const outcomes = () => taken.map(entry => entry.outcome);

    for (const [index, step] of definition.steps.entries()) {
      yield* store.beginStep(sagaId, index);
      const { calls, error } = yield* runStep(step, sagaId, inputs);

      const outcome: SagaStepOutcome = { stepId: step.id, calls };
      taken.push({ step, outcome });
      yield* store.recordOutcome(sagaId, outcome);

      if (error === undefined) {
        continue;
      }

      // Unwind. The failing step's own successful calls are compensated too —
      // a fan-out step that took three holds before its fourth was refused has
      // three to give back.
      yield* store.settle(sagaId, 'COMPENSATING', error);

      const failures: string[] = [];
      for (const done of [...taken].reverse()) {
        failures.push(
          ...(yield* compensateStep(done.step, sagaId, done.outcome)),
        );
      }

      if (failures.length > 0) {
        // ⚠️ Surfaced, never swallowed. This is the state that leaves a
        // reservation held and — once payment lands — a customer charged, and
        // ADR 0039 names it as the failure class nobody plans for.
        yield* Effect.logError('saga compensation failed').pipe(
          Effect.annotateLogs({
            sagaId,
            definition: definition.name,
            failures: failures.join('; '),
          }),
        );
        yield* store.settle(sagaId, 'STRANDED', error);
        return { state: 'STRANDED', outcomes: outcomes(), error };
      }

      yield* store.settle(sagaId, 'COMPENSATED', error);
      return { state: 'COMPENSATED', outcomes: outcomes(), error };
    }

    yield* store.settle(sagaId, 'COMPLETED');
    return { state: 'COMPLETED', outcomes: outcomes() };
  });
