import {
  type SagaDispatch,
  SagaDispatcherTag,
  type SagaResponse,
} from '@r10c/entifix-transactions';
import { EntifixConnError } from '@r10c/entifix-ts-core';
import {
  CROSSING_TOKEN_HEADER,
  ORGANIZATION_HEADER,
} from '@r10c/shells-effect-service';
import { Context, Effect, Layer } from 'effect';

/** The command id a participant claims, so a redelivery is not a second act. */
export const COMMAND_ID_HEADER = 'x-command-id';

/** One participant's address and the crossing token that reaches it. */
export interface Participant {
  readonly baseUrl: string;
  readonly crossingToken: string;
}

/**
 * Every participant this coordinator may invoke, by configuration key.
 *
 * ⚠️ **This is the concentration ADR 0023 recorded a residual for**, and
 * ADR 0039 restated: a process holding a crossing token can name any
 * organization, and this one holds several. It does not create a new class of
 * risk, it raises the value of one process. The named upgrade path is unchanged
 * — an RS256 service token minted by auth-service, giving the call an identity
 * rather than a password.
 */
export class ParticipantsTag extends Context.Tag('ParticipantsTag')<
  ParticipantsTag,
  Readonly<Record<string, Participant>>
>() {}

/**
 * Dispatch a saga step over HTTP.
 *
 * ⚠️ **A refusal is not a failure, and separating them is this adapter's whole
 * job.** A `4xx` is the participant's business answer — "not enough stock" —
 * and comes back as a *successful* effect carrying `ok: false`, so `runSaga`
 * fails the saga forward into compensation. A `5xx` or a transport error fails
 * the effect, so the dispatch is retried. Collapsing the two either retries an
 * out-of-stock line forever or permanently fails a checkout because a pod was
 * restarting ([ADR 0052](../../../../docs/adr/0052-the-checkout-saga.md)).
 *
 * ⚠️ **`x-command-id` is not decoration.** The participant claims it in the same
 * storage transaction as its side effect, so a redelivered command returns the
 * hold it already took rather than taking another. Without it an at-least-once
 * dispatch against `POST /api/reservation` oversells: stock held by nobody, the
 * ledger correct at every step, and availability quietly wrong.
 */
export const makeHttpSagaDispatcher = (
  participants: Readonly<Record<string, Participant>>,
) => ({
  dispatch: (dispatch: SagaDispatch): Effect.Effect<SagaResponse, EntifixConnError> =>
    Effect.gen(function* () {
      const participant = participants[dispatch.participant];
      if (!participant) {
        // A definition naming a participant this process was not configured
        // for. It is a wiring fault rather than a business outcome, so it fails
        // the effect and is retried after the configuration is fixed, instead
        // of compensating a saga that never got to run.
        return yield* Effect.fail(
          new EntifixConnError(
            'saga names a participant this coordinator has no address for',
            undefined,
            { participant: dispatch.participant },
          ),
        );
      }

      const headers: Record<string, string> = {
        'content-type': 'application/json',
        [CROSSING_TOKEN_HEADER]: participant.crossingToken,
        [COMMAND_ID_HEADER]: dispatch.commandId,
      };
      if (dispatch.organizationId !== undefined) {
        headers[ORGANIZATION_HEADER] = dispatch.organizationId;
      }

      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(`${participant.baseUrl}${dispatch.call.path}`, {
            method: dispatch.call.method,
            headers,
            body:
              dispatch.body === undefined
                ? undefined
                : JSON.stringify(dispatch.body),
          }),
        catch: error =>
          new EntifixConnError('saga step could not be delivered', error, {
            participant: dispatch.participant,
            path: dispatch.call.path,
          }),
      });

      if (response.status >= 500) {
        return yield* Effect.fail(
          new EntifixConnError('saga step participant failed', undefined, {
            participant: dispatch.participant,
            status: response.status,
          }),
        );
      }

      // A body is read even on a refusal: a `409` carries the `code` that says
      // *why*, and discarding it would leave an operator with a status and no
      // reason.
      const body = yield* Effect.tryPromise({
        try: () => response.json() as Promise<unknown>,
        // Not every participant answers with a body — a `204` has none — and a
        // step that succeeded must not be turned into a failure by an empty
        // one.
        catch: () => new EntifixConnError('unreadable participant body'),
      }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));

      return { ok: response.ok, status: response.status, body };
    }),
});

export const HttpSagaDispatcherLayer = Layer.effect(
  SagaDispatcherTag,
  Effect.map(ParticipantsTag, makeHttpSagaDispatcher),
);
