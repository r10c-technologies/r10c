import { Context } from 'effect';

import { type Action, permissionOf, type Resource } from '../values/permission';
import { can } from './can';

/** The subject half of a policy request — a `Principal` structurally satisfies it. */
export interface PolicySubject {
  readonly roles: readonly string[];
  readonly attributes?: Readonly<Record<string, unknown>>;
}

/**
 * What a caller wants to do, in attribute-based terms. `resource`, `attributes`
 * and `context` are the ABAC seam: the v1 implementation reads only
 * `subject.roles` and `resource`/`action`, but the shape is already the one a
 * rule engine needs, so adopting one never touches a call site.
 */
export interface PolicyRequest {
  readonly subject: PolicySubject;
  /** `<domain>:<entityKey>` — what is being acted on. */
  readonly resource: Resource;
  readonly action: Action;
  /** Request-time facts a future policy may read (tenant, time, ownership). */
  readonly context?: Readonly<Record<string, unknown>>;
}

/**
 * The authorization port. Synchronous on purpose: a decision must be cheap
 * enough to take on every request, and the v1 answer is a table lookup.
 */
export interface PolicyDecision {
  decide(request: PolicyRequest): boolean;
}

/** DI tag the composition root binds to a concrete {@link PolicyDecision}. */
export class PolicyDecisionTag extends Context.Tag('PolicyDecisionTag')<
  PolicyDecisionTag,
  PolicyDecision
>() {}

/**
 * The v1 implementation: role-derived grants from the static table, ignoring
 * resource attributes and context. Swapping in an attribute-aware engine is a
 * change of the `Layer` that provides {@link PolicyDecisionTag}, nothing more.
 */
export const makeStaticPolicyDecision = (): PolicyDecision => ({
  decide: ({ subject, resource, action }) =>
    can(subject.roles, permissionOf(resource, action)),
});
