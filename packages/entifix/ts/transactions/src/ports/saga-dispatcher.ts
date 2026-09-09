import type { EntifixConnError } from '@r10c/entifix-ts-core';
import { Context, type Effect } from 'effect';

import type { SagaCall } from '../contracts/saga-definition';

/** One call the engine wants made, fully resolved. */
export interface SagaDispatch {
  /** The participant's configuration key — the dispatcher resolves the address. */
  readonly participant: string;
  readonly call: SagaCall;
  /** `<sagaId>:<stepId>[:<index>]`, which the participant claims. */
  readonly commandId: string;
  /**
   * The organization this call acts for, when the participant is tenant-plane.
   *
   * Absent for a platform-plane participant. Present, it becomes ADR 0023's
   * `x-organization-id` — and it is safe only because the crossing token is
   * checked first, so the input the caller controls is never the input that
   * authorizes.
   */
  readonly organizationId?: string;
  readonly body?: unknown;
}

/**
 * What a dispatched call answered.
 *
 * ⚠️ **A refusal is not a failure, and the split is the dispatcher's job.** A
 * `409` from reserve is the business answer "not enough stock" and must fail the
 * saga *forward* into compensation; a `503` is a participant that is down and
 * the entry is retried. Collapsing the two either retries an out-of-stock line
 * forever or permanently fails a checkout because a pod was restarting
 * ([ADR 0052](../../../../../../docs/adr/0052-the-checkout-saga.md)).
 *
 * So a `refused` response is a **success** of this port carrying `ok: false`,
 * and only a transport or `5xx` failure is an `EntifixConnError`.
 */
export interface SagaResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly body: unknown;
}

export interface SagaDispatcher {
  dispatch(
    dispatch: SagaDispatch,
  ): Effect.Effect<SagaResponse, EntifixConnError>;
}

export class SagaDispatcherTag extends Context.Tag('SagaDispatcherTag')<
  SagaDispatcherTag,
  SagaDispatcher
>() {}
