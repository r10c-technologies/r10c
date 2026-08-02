import type { EntifixConnError } from '@r10c/entifix-ts-core';
import { Context, type Effect } from 'effect';

/**
 * Resolves the storage handle for one organization.
 *
 * The seam the whole tenancy model turns on. Business entities carry no
 * `organizationId` and no tenant filter, so isolation is *which handle a request
 * resolves to* — which means no query can leak by omission, because there is no
 * column to forget.
 *
 * Two rules the implementations must keep:
 *
 * - **Resolve per request, never per `Layer`.** The connection pool is acquired
 *   once at boot (`MongoDatabaseLayer`'s `Layer.scoped`); a handle is not a
 *   connection. Building a `Layer` per request would rebuild the pool per
 *   request.
 * - **Derive the storage name from the organization id**, never from a mutable
 *   attribute such as a slug, so renaming an organization can never strand its
 *   data.
 *
 * `THandle` is the datastore's own handle type (`Db` for Mongo). Keeping it
 * generic is what lets a Postgres adapter — where the same idea is a schema on
 * a shared pool rather than a separate database — satisfy the same port without
 * a call-site change.
 */
export interface TenantDatabaseResolver<THandle> {
  readonly forOrganization: (
    organizationId: string,
  ) => Effect.Effect<THandle, EntifixConnError>;
}

/**
 * DI tag for the resolver. Declared with an `unknown` handle because the tag is
 * datastore-agnostic; a service narrows it at the composition root, where it
 * also knows which driver it provided.
 */
export class TenantDatabaseResolverTag extends Context.Tag(
  'TenantDatabaseResolverTag',
)<TenantDatabaseResolverTag, TenantDatabaseResolver<unknown>>() {}
