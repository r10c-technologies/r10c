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
  readonly attributes: Readonly<Record<string, unknown>>;
}
