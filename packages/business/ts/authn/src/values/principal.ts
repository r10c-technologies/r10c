import type { EntityId } from '@r10c/entifix-ts-core';

/**
 * The authenticated subject as it travels to the microservices — the shape the
 * perimeter resolves a session into and injects into a request. It is a plain
 * readonly value object, not an entity: it crosses process boundaries (opaque
 * session in Redis → gateway → signed internal token) and carries only what a
 * downstream authorization decision needs.
 *
 * `roles` + `attributes` are the inputs an ABAC/RBAC policy decision reads;
 * they are captured at resolve time so the policy engine never has to fetch
 * subject attributes per request.
 */
export interface Principal {
  /** Canonical, IdP-independent user id — the value services key data against. */
  readonly userId: EntityId;
  /** The upstream IdP subject that authenticated this session (e.g. Zitadel `sub`). */
  readonly subject: string;
  /** Opaque session id this principal was resolved from; the revocation handle. */
  readonly sessionId: string;
  readonly roles: readonly string[];
  /**
   * The organization this session is acting for — a **storage routing key**, and
   * the reason it is a field of its own rather than an entry in `attributes`.
   * Attributes are policy inputs, where a wrong value produces a wrong decision;
   * a wrong organization produces a cross-tenant read. Different blast radius,
   * different field.
   *
   * Absent for a principal with no tenant scope: a buyer, or an operator.
   */
  readonly organizationId?: string;
  /**
   * Which population this principal belongs to — `customer`, `vendor` or
   * `operator`, the closed set in `business-ts-party-management`.
   *
   * It exists because {@link Principal.organizationId} cannot tell a buyer from
   * an operator: both hold no tenant scope, and their reach is entirely
   * different. Distinguishing the two by an absent field is how the most
   * sensitive boundary in the system would end up decided by an omission.
   *
   * Typed as a plain string here for the same reason `roles` is — a consumer
   * narrows it with `isPartyRoleName`.
   */
  readonly partyRole?: string;
  readonly attributes: Readonly<Record<string, unknown>>;
}
