import { isFailure } from '@entifix/core';
import { Effect, Option } from 'effect';

/** The levels a slice shell logs an outcome at. */
export type OutcomeLevel = 'Debug' | 'Info' | 'Warn' | 'Error';

/** A failure as log annotations: its code and category, never its text. */
export const failureFacts = (failure: unknown) =>
  isFailure(failure)
    ? { code: failure.code, category: failure.category }
    : // A legacy class or a defect carries no registered code; its text may
      // carry anything, so it is named `internal` and left out.
      { code: 'internal', category: 'internal' };

/**
 * The one way a slice shell logs what a use case, a cell, a consumer or a
 * sweep reported (ADR 0064): the outcome's own fields as annotations, a
 * failure's `code` and `category` beside them, and the trace the outcome was
 * reached under — never `String(error)`.
 */
export const logSliceOutcome = (
  level: OutcomeLevel,
  message: string,
  fields: Readonly<Record<string, unknown>>,
  failure?: unknown,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const span = yield* Effect.option(Effect.currentSpan);
    const traceId = Option.getOrUndefined(
      Option.map(span, open => open.traceId),
    );
    yield* Effect.logWithLevel(level)(message).pipe(
      Effect.annotateLogs({
        ...fields,
        ...(failure === undefined ? {} : failureFacts(failure)),
        ...(traceId === undefined ? {} : { traceId }),
      }),
    );
  });
