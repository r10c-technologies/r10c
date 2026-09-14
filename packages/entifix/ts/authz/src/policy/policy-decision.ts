import { Context } from 'effect';

import {
  type PermissionAction,
  permissionOf,
  type Resource,
} from '../values/permission';
import { can, type GrantTable } from './can';

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
  readonly action: PermissionAction;
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
 * The v1 implementation: role-derived grants from a table the host supplies,
 * ignoring resource attributes and context. Swapping in an attribute-aware
 * engine is a change of the `Layer` that provides {@link PolicyDecisionTag},
 * nothing more.
 *
 * ⚠️ **The table is an argument now, and that is the whole seam.** It used to be
 * imported, which meant this framework shipped the sentence "a `user` may ring
 * up a counter sale" to everyone who installed it. Passing it in costs one
 * argument at each composition root and is what lets two applications with
 * different roles share a policy engine.
 */
export const makeStaticPolicyDecision = (
  grants: GrantTable,
): PolicyDecision => ({
  decide: ({ subject, resource, action }) =>
    can(grants, subject.roles, permissionOf(resource, action)),
});
