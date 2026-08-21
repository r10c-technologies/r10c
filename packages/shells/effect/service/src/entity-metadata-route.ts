import { createHash } from 'node:crypto';

import { HttpServerRequest, HttpServerResponse } from '@effect/platform';
import {
  parsePermission,
  type Permission,
  permissionForEntity,
  permissionForUseCase,
  PolicyDecisionTag,
} from '@r10c/business-ts-authz';
import {
  describeEntityUseCases,
  type Entity,
  ENTITY_ACTIONS,
  type EntityConstructor,
  type EntityMetadataDocument,
  extractMetaEntity,
  makeEntityMetadataEnvelope,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';

import { requirePrincipal } from './auth';

/**
 * `GET /api/<entity>/$metadata` — what this caller may do with one entity.
 *
 * Mounted **per entity, at a literal path**, not as a `/api/:entity/$metadata`
 * wildcard. `HttpRouter` resolves through `find-my-way-ts`, where a static
 * segment beats a parametric one and there is no backtracking once the
 * parametric branch has matched: alongside an existing `/api/<entity>/:id`, a
 * wildcard `$metadata` route never runs at all — the by-id handler wins with
 * `id === "$metadata"`, misses, and answers its own `404`. The endpoint would
 * read as "this entity has no metadata" while appearing mounted. A literal wins
 * regardless of registration order, which is why the base exports a route for
 * one entity and each service registers it for each of its own
 * ([ADR 0026](../../../../../docs/adr/0026-the-use-case-descriptor-and-served-entity-metadata.md)).
 *
 * Deliberately **not** behind `requireOrganization`, even on a tenant-plane
 * service: the document describes the model, not tenant data, and resolving a
 * database handle here would leave a vendor with no active organization unable
 * to see their own affordances.
 */
export const entityMetadataRoute = <TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
) =>
  requirePrincipal(principal =>
    Effect.gen(function* () {
      const policy = yield* PolicyDecisionTag;
      const allows = (permission: Permission): boolean => {
        const { resource, action } = parsePermission(permission);
        return policy.decide({
          subject: { roles: principal.roles },
          resource,
          action,
        });
      };

      // SECURITY BOUNDARY. The document names domains, entity keys and verbs —
      // it is a map of the model — so an entity the caller may not read answers
      // exactly as one this service does not host. A `403` here would make the
      // endpoint an oracle: walk it and learn the shape of everything you are
      // not allowed to see. Same category as `redactConfiguration`, not
      // diagnostics polish.
      if (!allows(permissionForEntity(entityConstructor, 'read'))) {
        return yield* notFound(entityConstructor);
      }

      const document: EntityMetadataDocument = {
        actions: ENTITY_ACTIONS.filter(action =>
          allows(permissionForEntity(entityConstructor, action)),
        ),
        useCases: describeEntityUseCases(entityConstructor).filter(descriptor =>
          allows(permissionForUseCase(entityConstructor, descriptor.key)),
        ),
      };

      // The ETag hashes the *computed* document, not the descriptor set the
      // deployment declares. Two principals with different grants get different
      // documents from the same model, so a hash of the model would `304` one
      // caller onto another's affordances. Hashing the permission set instead
      // would read `ROLE_PERMISSIONS` directly and go around `PolicyDecisionTag`,
      // so an injected ABAC policy could change affordances without changing the
      // tag. Computing first costs a metadata read and a handful of pure
      // `decide` calls — no IO.
      const body = JSON.stringify(
        makeEntityMetadataEnvelope(entityConstructor, document),
      );
      const etag = `"${createHash('sha256').update(body).digest('hex')}"`;

      const request = yield* HttpServerRequest.HttpServerRequest;
      if (request.headers['if-none-match'] === etag) {
        return HttpServerResponse.empty({ status: 304 }).pipe(
          HttpServerResponse.setHeaders(cacheHeaders(etag)),
        );
      }

      return HttpServerResponse.text(body, {
        contentType: 'application/json',
        headers: cacheHeaders(etag),
      });
    }),
  );

/**
 * The response varies by principal, so it must never land in a shared cache.
 * `Vary` names **both** credential carriers because the shell reads the access
 * token from the `r10c_at` cookie *or* an `Authorization: Bearer` header, and a
 * cache keyed on only one of them would serve across the other.
 */
const cacheHeaders = (etag: string) => ({
  etag,
  'cache-control': 'private, no-cache',
  vary: 'Cookie, Authorization',
});

/** Indistinguishable from the `404` a service gives for an entity it does not host. */
const notFound = <TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
) =>
  HttpServerResponse.json(
    {
      message: 'not found',
      code: 'notFound',
      entity: extractMetaEntity(entityConstructor).key,
    },
    { status: 404 },
  );
