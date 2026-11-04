import { decodeProblem, type EntifixFailure, isFailure } from '@entifix/core';

/**
 * The typed failure a non-2xx answer names.
 *
 * Every service answers `application/problem+json` with a `code` the `errors`
 * catalog holds (ADR 0064), so the browser decodes the body back into the
 * failure it was rather than reading an `error` or `message` string off it. A
 * body that is not a problem — a proxy's HTML, an empty `502` — still decodes,
 * to a `ProtocolFailure` carrying the status, so the caller always has a
 * failure to render.
 */
export const failedResponse = async (
  response: Response,
): Promise<EntifixFailure> =>
  decodeProblem(await response.json().catch(() => undefined), response.status);

/**
 * Whatever a loader rejected with, as a failure: its own when it threw one,
 * and otherwise — a network error, a body that would not deserialize — the
 * `ProtocolFailure` an unreadable answer decodes to.
 */
export const asFailure = (error: unknown): EntifixFailure =>
  isFailure(error) ? error : decodeProblem(undefined);
