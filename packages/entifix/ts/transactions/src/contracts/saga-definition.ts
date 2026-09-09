import { EntifixLogicError } from '@r10c/entifix-ts-core';

/**
 * Richardson's classification, and adopting the vocabulary is most of the answer
 * to "which steps are compensable at all"
 * ([ADR 0039](../../../../../../docs/adr/0039-multi-step-sagas-are-orchestrated.md)).
 *
 * - `compensatable` — before the point of no return; a failure downstream
 *   reverses it.
 * - `pivot` — the point of no return. Once it commits, the saga goes forward.
 * - `retriable` — after the pivot; no compensation exists, so the only path is
 *   to retry until it succeeds.
 */
export type SagaStepKind = 'compensatable' | 'pivot' | 'retriable';

/** The HTTP verbs a step may be dispatched with. */
export type SagaMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * One call a step makes, as a template rather than a closure.
 *
 * `path` may carry `{…}` placeholders resolved by field path against the step's
 * recorded outcome — `/api/reservation/{outcome.data.id}`.
 *
 * ⚠️ **A template rather than a callback, and that is the constraint that
 * shaped the whole type.** A callback would have to name the participant's
 * types, and a `business:domain` package may not import another
 * (`docs/_shared/layering.md`) — which is exactly the import that has no legal
 * home and the reason ADR 0039 made a definition **data** in the first place.
 */
export interface SagaCall {
  readonly method: SagaMethod;
  readonly path: string;
}

/** One step of a flow. */
export interface SagaStep {
  /** Unique within the definition; half of the command id `<sagaId>:<stepId>`. */
  readonly id: string;
  /**
   * Which service answers it, as a **configuration key** — never a URI.
   *
   * A URI in a definition is a deployment fact written into a business
   * artifact, and it is what makes a definition untestable and un-relocatable.
   * The same lookup yields the crossing token for that participant, so a
   * definition carries no secret and never could
   * ([ADR 0052](../../../../../../docs/adr/0052-the-checkout-saga.md)).
   */
  readonly participant: string;
  readonly command: SagaCall;
  /** Required on a `compensatable` step, forbidden on every other kind. */
  readonly compensation?: SagaCall;
  readonly kind: SagaStepKind;
  /**
   * Dispatch one call per element of this step's input, rather than one call.
   *
   * ⚠️ **Cardinality is data, because it has to be.** Checkout reserves once per
   * vendor and how many vendors is known only from the cart, so writing that as
   * N steps would mean generating a definition per request — at which point it
   * is no longer data, and ADR 0039's whole construction collapses back into the
   * class that has no legal home.
   *
   * The consequence carried by {@link SagaStepOutcome}: **the unit of
   * compensation is the call, not the step.** Five lines with three holds taken
   * and the fourth refused must release exactly three.
   */
  readonly fanOut?: boolean;
  /**
   * Fan out over an **earlier step's successful calls** instead of over an
   * input the caller supplied.
   *
   * ⚠️ **Without this a later step cannot address what an earlier one created**,
   * and checkout is the case that proves it. `convert-reservation` needs one
   * call per hold, addressed by the reservation id — which stock-service mints,
   * so the caller cannot know it when it starts the flow. Supplying the ids as
   * input is impossible, and generating a definition per request is the thing
   * ADR 0039 exists to avoid.
   *
   * Each element inherits that call's `organizationId`, so a tenant-plane
   * participant reaches the same tenant it did the first time, and the `path`
   * template resolves against `{outcome.…}` — the same scope a compensation
   * gets, for the same reason: the id being addressed is in the response body.
   *
   * Implies {@link fanOut}. It names a step that must appear **before** this one,
   * and `defineSaga` refuses a forward or self reference at module load.
   */
  readonly fanOutFrom?: string;
}

/** A flow, as the data a generic engine walks. */
export interface SagaDefinition {
  readonly name: string;
  /**
   * What a caller must hold to run this flow, as a `<domain>:<entity>:<action>`
   * string.
   *
   * ⚠️ **On the definition rather than on the route**, so the route that runs a
   * flow stays generic. The alternative was one permission for every saga, which
   * would make "may run a flow" a single capability regardless of what the flow
   * does — and checkout writes an order.
   *
   * It is a plain string here rather than authz's `Permission`: this package is
   * `layer:entifix`, and `business-ts-authz` sits above it. The service that
   * mounts the route resolves the string against
   * `SERVICE_CROSSING_PERMISSIONS`, which is where the closed list belongs.
   */
  readonly permission: string;
  readonly steps: readonly SagaStep[];
}

/** What one dispatched call returned, kept so its compensation can read it. */
export interface SagaCallOutcome {
  /** The fan-out element this call was made for; `0` on a single-call step. */
  readonly index: number;
  readonly status: number;
  readonly body: unknown;
  /**
   * The organization this call acted for, carried so its compensation acts on
   * the same one.
   *
   * ⚠️ **Not derivable from the outcome, and its absence is silent.** A
   * tenant-plane participant resolves its storage handle from
   * `x-organization-id`, so a compensation dispatched without it is refused
   * `400` — and the saga strands with every hold still in place while the
   * engine reports it tried. Measured on the live lab: two holds taken, a third
   * line refused, and both releases rejected for a missing header
   * ([ADR 0023](../../../../../../docs/adr/0023-service-to-service-tenant-crossing.md)).
   */
  readonly organizationId?: string;
}

/** Every call one step made, in dispatch order. */
export interface SagaStepOutcome {
  readonly stepId: string;
  readonly calls: readonly SagaCallOutcome[];
}

const fail = (definition: string, detail: string): never => {
  throw new EntifixLogicError(
    `saga definition '${definition}' is invalid: ${detail}`,
    undefined,
    { definition },
  );
};

/**
 * Validate a definition and return it, or throw.
 *
 * ⚠️ **At load, not at the step.** A fault that only appears on the unlucky path
 * is a fault that ships — the same reasoning ADR 0035 used for `collection` +
 * `determining`. Every definition is therefore constructed through this
 * function at module scope, and loaded in a spec: a definition that never loads
 * is a definition that never fails.
 */
export function defineSaga(definition: SagaDefinition): SagaDefinition {
  const { name, steps } = definition;

  if (steps.length === 0) {
    fail(name, 'it declares no steps');
  }

  const seen = new Set<string>();
  for (const step of steps) {
    if (seen.has(step.id)) {
      // The command id is `<sagaId>:<stepId>`, so a duplicate id is two steps
      // sharing one idempotency key — the second would be dropped as a
      // redelivery of the first and never run at all.
      fail(name, `two steps share the id '${step.id}'`);
    }
    seen.add(step.id);
  }

  // `fanOutFrom` must name a step that has already run, or the outcomes it fans
  // out over do not exist yet. A forward reference would silently produce zero
  // calls — a step that looks like it ran and did nothing, which is exactly how
  // a conversion gets skipped while a saga reports COMPLETED.
  const before = new Set<string>();
  for (const step of steps) {
    if (step.fanOutFrom !== undefined && !before.has(step.fanOutFrom)) {
      fail(
        name,
        `step '${step.id}' fans out from '${step.fanOutFrom}', which is not a ` +
          'step before it',
      );
    }
    before.add(step.id);
  }

  const pivots = steps.filter(step => step.kind === 'pivot');
  if (pivots.length > 1) {
    // A flow with two points of no return is a flow that has not been designed
    // yet, and the engine says so out loud (ADR 0039).
    fail(
      name,
      `it declares ${String(pivots.length)} pivots (${pivots
        .map(step => step.id)
        .join(', ')}); a flow has at most one point of no return`,
    );
  }

  // ⚠️ **Zero pivots is legal**, and checkout is the case that forced saying so.
  // Payment capture is M4; until it lands every step of checkout reverses. A
  // validator demanding exactly one would push the order write into a role it
  // would have to be removed from later — a wrong answer that passes
  // (ADR 0052). A definition with no pivot means the whole saga can be unwound,
  // which is a stronger property than a pivot rather than a missing one.
  const pivot = pivots[0];
  const pivotAt = pivot ? steps.indexOf(pivot) : -1;
  const afterPivot = (index: number) => pivot !== undefined && index > pivotAt;

  for (const [index, step] of steps.entries()) {
    switch (step.kind) {
      case 'compensatable': {
        if (afterPivot(index)) {
          fail(
            name,
            `step '${step.id}' is compensatable but sits after the pivot ` +
              `'${String(pivot?.id)}', where nothing can be reversed`,
          );
        }
        if (!step.compensation) {
          fail(
            name,
            `step '${step.id}' is compensatable but declares no compensation`,
          );
        }
        break;
      }
      case 'pivot':
      case 'retriable': {
        if (step.compensation) {
          // Not dead code — a *false assurance*. Such a compensation could
          // never run, so writing one says the step is reversible when it is
          // not (ADR 0039).
          fail(
            name,
            `step '${step.id}' is ${step.kind} and declares a compensation, ` +
              'which could never run',
          );
        }
        if (step.kind === 'retriable' && !afterPivot(index)) {
          fail(
            name,
            `step '${step.id}' is retriable but sits before the pivot; a step ` +
              'that cannot be reversed must not run while the saga can still ' +
              'be unwound',
          );
        }
        break;
      }
    }
  }

  return definition;
}

/**
 * The command id one call is dispatched under.
 *
 * `<sagaId>:<stepId>` — the shape `transactionEventId` already uses for events,
 * so #178's `TransactionInbox` serves saga steps with no second dedup store and
 * no second key. A fan-out step appends the element index, because its calls are
 * separate side effects that must each be claimed on their own.
 */
export const sagaCommandId = (
  sagaId: string,
  stepId: string,
  index?: number,
): string =>
  index === undefined
    ? `${sagaId}:${stepId}`
    : `${sagaId}:${stepId}:${String(index)}`;
