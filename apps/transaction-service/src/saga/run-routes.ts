import { randomUUID } from 'node:crypto';

import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from '@effect/platform';
import {
  runSaga,
  type SagaInputs,
  type SagaStepInput,
} from '@r10c/entifix-transactions';
import { makeEnvelope } from '@r10c/entifix-ts-core';
import { requirePrincipal } from '@r10c/shells-effect-service';
import { Effect } from 'effect';

import { SAGAS } from '../sagas/checkout.saga';

const serverError = (error: unknown) =>
  HttpServerResponse.json(
    { error: 'request failed', code: 'serverError', detail: String(error) },
    { status: 500 },
  );

const isStepInput = (value: unknown): value is SagaStepInput =>
  typeof value === 'object' && value !== null;

/**
 * `inputs` off the wire, narrowed.
 *
 * ⚠️ A malformed body is rejected before a saga id is minted. The alternative
 * is an instance in the store that never dispatched anything, which an operator
 * then has to tell apart from one whose first step is genuinely slow.
 */
const readInputs = (body: unknown): SagaInputs | undefined => {
  if (typeof body !== 'object' || body === null) {
    return undefined;
  }
  const inputs = (body as { inputs?: unknown }).inputs;
  if (typeof inputs !== 'object' || inputs === null) {
    return undefined;
  }
  const entries = Object.entries(inputs as Record<string, unknown>);
  if (
    !entries.every(
      ([, value]) => Array.isArray(value) && value.every(isStepInput),
    )
  ) {
    return undefined;
  }
  return Object.fromEntries(entries) as SagaInputs;
};

/**
 * Start a flow and answer when it settles.
 *
 * ⚠️ **Generic on purpose, and the `transaction` slice's `domains: []` is why.**
 * A `/api/checkout` route here would put a business verb in a slice that owns no
 * domain — and a domain name is simultaneously a package identity, a permission
 * namespace and an entitlement key (ADR 0005). Orchestration is a *mechanism*:
 * this route runs whichever declared definition it is named, and the definition
 * is data that imports nothing (ADR 0039).
 *
 * ⚠️ **Synchronous, and that is the buyer's requirement rather than a
 * shortcut.** A checkout needs a yes/no now — ADR 0010's reason the reservation
 * model exists at all — so this answers the settled result rather than a `202`.
 * The pending-write protocol stays where it belongs: on the single-step catalog
 * writes that genuinely take a moment.
 */
const runRoute = requirePrincipal(() =>
  Effect.gen(function* () {
    const params = yield* HttpRouter.params;
    const definition = SAGAS[params.definition ?? ''];
    if (!definition) {
      return yield* HttpServerResponse.json(
        { error: 'no such saga', code: 'notFound' },
        { status: 404 },
      );
    }

    const request = yield* HttpServerRequest.HttpServerRequest;
    const inputs = readInputs(yield* request.json);
    if (!inputs) {
      return yield* HttpServerResponse.json(
        {
          error: 'invalid request body',
          code: 'invalidBody',
          detail: 'inputs must be an object of step id to an array of inputs',
        },
        { status: 400 },
      );
    }

    // Server-minted, for the reason every other id in the fleet is: a caller
    // that could choose it could resume — or overwrite — somebody else's flow.
    // ADR 0028's client-minted id is the *transaction* id on a single-step
    // write, where the client needs it to poll before the write has landed;
    // here the response carries the result, so there is nothing to poll for and
    // no reason to let the id in.
    const sagaId = randomUUID();

    const result = yield* runSaga({ sagaId, definition, inputs });

    return yield* HttpServerResponse.json(
      makeEnvelope('sagaResult', definition.name, { sagaId, ...result }),
      // A saga that compensated is not a server error and not the caller's
      // mistake: the request was well formed and conflicts with the current
      // state, which is what `409` means everywhere else in this fleet.
      // `STRANDED` is a `500` because something *is* wrong here and an operator
      // has to look.
      {
        status:
          result.state === 'COMPLETED'
            ? 201
            : result.state === 'COMPENSATED'
              ? 409
              : 500,
      },
    );
  }),
).pipe(Effect.catchAll(serverError));

export const sagaRunRoutes = <E, R>(router: HttpRouter.HttpRouter<E, R>) =>
  router.pipe(HttpRouter.post('/api/saga/:definition', runRoute));

export { readInputs };
