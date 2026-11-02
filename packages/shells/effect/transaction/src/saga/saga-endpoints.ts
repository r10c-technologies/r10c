import { randomUUID } from 'node:crypto';

import type { Permission } from '@entifix/authz';
import { RequestPrincipalTag } from '@entifix/business';
import {
  defineEndpoint,
  DuplicateKey,
  implement,
  JsonBody,
  makeEnvelope,
  NotFound,
} from '@entifix/core';
import {
  type SagaDefinition,
  type SagaInputs,
  type SagaInstance,
  type SagaStepInput,
  SagaStoreTag,
} from '@entifix/transactions';
import { runSaga } from '@entifix/transactions/engine';
import { categorised, InvalidBody } from '@r10c/business-ts-common';
import {
  SagaCompensated,
  SagaStranded,
} from '@r10c/business-ts-saga-contracts';
import { Effect, Schema } from 'effect';

import { SAGAS } from '../sagas/index.js';

const isStepInput = (value: unknown): value is SagaStepInput =>
  typeof value === 'object' && value !== null;

/**
 * `inputs` off the wire, narrowed.
 *
 * ⚠️ A malformed body is refused before a saga id is minted. The alternative
 * is an instance in the store that never dispatched anything, which an operator
 * then has to tell apart from one whose first step is genuinely slow.
 */
export const readInputs = (body: unknown): SagaInputs | undefined => {
  if (typeof body !== 'object' || body === null) return undefined;
  const inputs = (body as { inputs?: unknown }).inputs;
  if (typeof inputs !== 'object' || inputs === null) return undefined;
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
 * The step a compensated flow was refused at. The engine records the refusing
 * step's outcome, with its error, before it compensates, so a compensated
 * result always carries one.
 */
const refusedStepOf = (
  outcomes: readonly { readonly stepId: string; readonly error?: unknown }[],
) =>
  (
    outcomes.find(outcome => outcome.error !== undefined) as {
      readonly stepId: string;
    }
  ).stepId;

/**
 * `POST /api/saga/<definition>` — start a flow and answer when it settles.
 *
 * ⚠️ **One endpoint per registered definition, generic in shape.** The
 * `transaction` slice declares no domain, so a `/api/checkout` here would put
 * a business verb in a permission namespace nothing is provisioned for (ADR
 * 0005). Each definition carries its own permission as a plain string —
 * `@entifix/transactions` sits below `@entifix/authz` — and its endpoint is
 * guarded by it, so "may run a flow" is never one capability whatever the
 * flow does.
 *
 * ⚠️ **Synchronous, the buyer's requirement rather than a shortcut**: a
 * checkout needs a yes or no now. Completed answers the result; a flow
 * refused before its pivot and fully compensated is the `sagaCompensated`
 * conflict, naming the step that refused; one stranded past its pivot is
 * `sagaStranded`, an internal fault an operator has to look at. A start is
 * remembered at the edge on its `Idempotency-Key`, so a retried start or a
 * cancellation asked for twice runs one flow (ADR 0068).
 */
const runEndpoint = (definition: SagaDefinition) =>
  implement(
    defineEndpoint({
      name: `run-${definition.name}`,
      method: 'POST',
      path: `/api/saga/${definition.name}`,
      payload: JsonBody,
      success: JsonBody,
      errors: [InvalidBody, SagaCompensated, DuplicateKey],
      guard: {
        kind: 'crossing',
        permission: definition.permission as Permission,
        organization: false,
      },
      idempotent: 'edge',
    }),
    ({ payload }) =>
      Effect.gen(function* () {
        const inputs = readInputs(payload);
        if (!inputs) {
          return yield* new InvalidBody({
            reason: 'inputs must be an object of step id to an array of inputs',
          });
        }
        // Server-minted: a caller that could choose it could resume — or
        // overwrite — somebody else's flow.
        const sagaId = randomUUID();
        const result = yield* categorised(
          runSaga({ sagaId, definition, inputs }),
        );
        if (result.state === 'COMPENSATED') {
          return yield* new SagaCompensated({
            sagaId,
            refusedStep: refusedStepOf(result.outcomes),
          });
        }
        if (result.state === 'STRANDED') {
          return yield* new SagaStranded({ sagaId });
        }
        return makeEnvelope('sagaResult', definition.name, {
          sagaId,
          ...result,
        });
      }),
  );

/**
 * Which organizations a flow actually touched, read off what it dispatched —
 * a set, because a basket spanning two vendors takes holds in two tenant
 * databases, and the platform-plane steps carry none at all.
 */
const organizationsIn = (instance: SagaInstance): ReadonlySet<string> => {
  const organizations = new Set<string>();
  for (const outcome of instance.outcomes) {
    for (const call of outcome.calls) {
      if (call.organizationId !== undefined) {
        organizations.add(call.organizationId);
      }
    }
  }
  return organizations;
};

/**
 * `GET /api/saga/:id` — where a flow stopped, and what has been reversed: a
 * read against one store rather than a correlation across three services'
 * logs (ADR 0039).
 *
 * ⚠️ **Session-guarded and scoped, with no permission of its own**: the slice
 * declares no domain. The scope is the principal's organization among the
 * calls the flow made, and anything else — another organization's flow, or one
 * that died before its first call and so belongs to nobody — answers exactly
 * as an absent one does. A `403` would confirm that a given checkout happened.
 * There is deliberately no list: the store is control plane and single
 * partition, so an unfiltered index is every organization's flows.
 */
export const sagaInstanceEndpoint = implement(
  defineEndpoint({
    name: 'saga-instance',
    method: 'GET',
    path: '/api/saga/:id',
    params: { id: Schema.String },
    success: JsonBody,
    errors: [NotFound, DuplicateKey],
    guard: { kind: 'session' },
  }),
  ({ params }) =>
    Effect.gen(function* () {
      const principal = yield* RequestPrincipalTag;
      const store = yield* SagaStoreTag;
      const instance = yield* categorised(store.get(params.id));
      if (
        instance === undefined ||
        principal.organizationId === undefined ||
        !organizationsIn(instance).has(principal.organizationId)
      ) {
        return yield* new NotFound({ entity: 'saga' });
      }
      return makeEnvelope('sagaInstance', instance.definition, instance);
    }),
);

/** A start per registered flow, each behind its own permission. */
export const sagaRunEndpoints = Object.values(SAGAS).map(runEndpoint);

/** The coordinator's surface: the starts, and the instance read. */
export const sagaEndpoints = [...sagaRunEndpoints, sagaInstanceEndpoint];
