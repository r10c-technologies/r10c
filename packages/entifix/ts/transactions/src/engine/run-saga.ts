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
import { resolveBodyTemplate, resolveTemplate } from './resolve-template';

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

/**
 * What one element of a `fanOutFrom` step is dispatched with.
 *
 * The earlier call's body travels as `outcome` rather than `input`, which is the
 * same scope a compensation resolves against and for the same reason: the id
 * being addressed was minted by the participant and is in its response.
 */
interface DerivedElement {
  readonly input: SagaStepInput;
  readonly scope: Record<string, unknown>;
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

/**
 * The elements a step actually dispatches: derived from an earlier step's
 * successful calls when it declares `fanOutFrom`, and from the caller's input
 * otherwise.
 *
 * ⚠️ **A `fanOutFrom` step ignores whatever the caller supplied for it.** The
 * cardinality is the earlier step's, and taking the caller's would let a
 * checkout convert a hold it never took — or, more likely, silently convert
 * none, which is how a saga reports COMPLETED with the goods still held.
 */
/**
 * What every step can point at: the **first successful call** of each step that
 * has already run, by step id.
 *
 * First rather than all, because a template naming a fan-out step is ambiguous
 * by construction — "the order id" is one value and "the reservation ids" are
 * many, and the many case is what `fanOutFrom` exists for. Keeping this to the
 * unambiguous case is what stops `{steps.reserve.data.id}` quietly meaning
 * "whichever hold happened to be first".
 */
const stepsScope = (
  taken: ReadonlyArray<{ step: SagaStep; outcome: SagaStepOutcome }>,
): Record<string, unknown> =>
  Object.fromEntries(
    taken
      .filter(entry => entry.outcome.calls.length > 0)
      .map(entry => [entry.step.id, entry.outcome.calls[0]?.body]),
  );

const elementsFor = (
  step: SagaStep,
  inputs: SagaInputs,
  taken: ReadonlyArray<{ step: SagaStep; outcome: SagaStepOutcome }>,
): readonly DerivedElement[] => {
  const steps = stepsScope(taken);

  if (step.fanOutFrom === undefined) {
    return inputsFor(step, inputs).map(input => ({
      input,
      scope: { input: input.body, steps },
    }));
  }

  const source = taken.find(entry => entry.step.id === step.fanOutFrom);
  const body = inputs[step.id]?.[0]?.body;

  return (source?.outcome.calls ?? []).map(call => ({
    // ⚠️ The organization the *earlier call* acted for, never the caller's.
    // A tenant-plane participant resolves its handle from the header, so a
    // conversion dispatched without it is refused `400` and the hold expires
    // under a buyer who has already been charged.
    input: { body, organizationId: call.organizationId },
    scope: { outcome: call.body, input: body, steps },
  }));
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
          : resolveBodyTemplate(input.body, scope),
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
  elements: readonly DerivedElement[],
): Effect.Effect<
  { readonly calls: readonly SagaCallOutcome[]; readonly error?: string },
  EntifixConnError,
  SagaDispatcherTag
> =>
  Effect.gen(function* () {
    const calls: SagaCallOutcome[] = [];

    for (const [index, element] of elements.entries()) {
      const { input } = element;
      const response = yield* dispatchCall(
        step,
        step.command,
        sagaId,
        index,
        input,
        element.scope,
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

      calls.push({
        index,
        status: response.status,
        body: response.body,
        // Carried so the compensation reaches the same tenant. Without it a
        // release is refused `400` and the saga strands holding stock.
        organizationId: input.organizationId,
      });
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
        // ⚠️ The organization the *call* acted for, not an empty input. A
        // tenant-plane participant resolves its handle from the header, so a
        // compensation without it is refused before it reaches the hold.
        { organizationId: call.organizationId },
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
 * How many extra times a step is dispatched once the pivot has committed.
 *
 * Small and immediate on purpose. This is the in-process half of "roll forward",
 * and it exists to ride out the blip — a participant restarting, a connection
 * reset — not to be a retry policy. A step that is still refusing after these
 * strands the saga, loudly, because the alternative is a coordinator spinning on
 * a permanent failure while a customer's money sits captured.
 *
 * Durable retry across a coordinator restart is a different mechanism and is not
 * built: see #233, which makes a step dispatch an outbox entry whose relay
 * performs the POST.
 */
const POST_PIVOT_RETRIES = 3;

/**
 * Dispatch a step, retrying it `retries` more times while it refuses.
 *
 * ⚠️ **A retry re-dispatches the calls that already succeeded**, and that is
 * safe for exactly one reason: `sagaCommandId(sagaId, step.id, index)` is stable
 * across attempts, so a participant that is idempotent on the command id
 * recognises the replay. ADR 0052 states that requirement on the participant;
 * this is the code that depends on it.
 */
const runStepWithRetries = (
  step: SagaStep,
  sagaId: string,
  elements: readonly DerivedElement[],
  retries: number,
): Effect.Effect<
  { readonly calls: readonly SagaCallOutcome[]; readonly error?: string },
  EntifixConnError,
  SagaDispatcherTag
> =>
  Effect.gen(function* () {
    let result = yield* runStep(step, sagaId, elements);

    for (
      let attempt = 1;
      attempt <= retries && result.error !== undefined;
      attempt += 1
    ) {
      yield* Effect.logWarning('retrying a saga step after the pivot').pipe(
        Effect.annotateLogs({
          sagaId,
          stepId: step.id,
          attempt,
          error: result.error,
        }),
      );
      result = yield* runStep(step, sagaId, elements);
    }

    return result;
  });

/**
 * Walk a definition: dispatch each step, and on a refusal unwind every
 * compensatable step already taken.
 *
 * The state transition is persisted **before** each dispatch, so a crash leaves
 * a record that says what was actually attempted (ADR 0028, extended to
 * commands by ADR 0039).
 *
 * ⚠️ **Once the pivot has committed, nothing is unwound.** That is what a pivot
 * means, and the walk has to know it rather than the definition merely declaring
 * it: `compensateStep` no-ops on a step that declares no compensation, so an
 * unconditional unwind after a successful capture would skip the pivot in
 * silence and then delete the order behind it and release the holds behind that
 * — money taken, goods back on sale, every probe green. The step is retried
 * instead, and a saga that still cannot go forward is settled `STRANDED` and
 * logged, because ADR 0039 is explicit that a stranded saga nobody is told about
 * is the same as a lost one.
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

    // The point of no return, once it is behind us. Tracked here rather than
    // read off the definition because what matters is not that a pivot exists
    // but that it *committed* — a pivot that refuses is still fully reversible,
    // and is the ordinary compensation case below.
    let pivotCommitted = false;

    for (const [index, step] of definition.steps.entries()) {
      yield* store.beginStep(sagaId, index);
      const { calls, error } = yield* runStepWithRetries(
        step,
        sagaId,
        elementsFor(step, inputs, taken),
        pivotCommitted ? POST_PIVOT_RETRIES : 0,
      );

      const outcome: SagaStepOutcome = { stepId: step.id, calls };
      taken.push({ step, outcome });
      yield* store.recordOutcome(sagaId, outcome);

      if (error === undefined) {
        if (step.kind === 'pivot') {
          pivotCommitted = true;
        }
        continue;
      }

      if (pivotCommitted) {
        // ⚠️ Forward or nowhere. Compensating from here would undo steps whose
        // effects the pivot has already been paid for.
        yield* Effect.logError('saga stranded after the pivot').pipe(
          Effect.annotateLogs({
            sagaId,
            definition: definition.name,
            stepId: step.id,
            error,
          }),
        );
        yield* store.settle(sagaId, 'STRANDED', error);
        return { state: 'STRANDED', outcomes: outcomes(), error };
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
