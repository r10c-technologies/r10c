import { Failure } from '@entifix/core';
import { Effect, Schema } from 'effect';

/**
 * A bulk action over more rows than one request takes. Past the cap the work
 * would be a long-running flow, which is not built, so the request is refused
 * whole — before any row is touched — rather than acting on the first `max`
 * rows and saying nothing about the rest (ADR 0035).
 */
export class SelectionTooLarge extends Failure.invalid<SelectionTooLarge>()(
  'SelectionTooLarge',
  'selectionTooLarge',
  { max: Schema.Number },
  { message: ({ max }) => `a bulk action takes at most ${String(max)} rows` },
) {}

/**
 * Refuses a selection of `count` rows when it is past `max` — called once the
 * selection is resolved and before any row is touched.
 */
export const refuseSelectionAbove = (max: number, count: number) =>
  count > max ? Effect.fail(new SelectionTooLarge({ max })) : Effect.void;
