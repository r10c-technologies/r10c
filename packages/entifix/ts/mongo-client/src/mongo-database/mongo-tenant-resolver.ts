import type { TenantDatabaseResolver } from '@r10c/entifix-ts-business';
import { EntifixConnError } from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import type { Db, MongoClient } from 'mongodb';

/** Mongo's own limit on a database name, minus room for a prefix. */
const MAX_DB_NAME_LENGTH = 63;

/**
 * Mongo names a database with a small character set. An organization id is a
 * hex ObjectId today, but this guards the shape rather than trusting it: a name
 * assembled from an unvalidated id is a place where a crafted value could reach
 * another tenant's database.
 */
const SAFE_ORGANIZATION_ID = /^[a-zA-Z0-9_-]+$/;

/**
 * Resolves one organization's Mongo database from a single connected client.
 *
 * Cheap by construction: `client.db(name)` returns a **handle**, not a
 * connection, so N organizations share one pool and one socket set, and Mongo
 * creates the database lazily on first write — which is why provisioning an
 * organization is a control-plane record plus this naming convention, with no
 * `CREATE DATABASE` step to fail halfway.
 *
 * Call it inside the request. The pool is the boot-time `MongoDatabaseLayer`;
 * wrapping this in a per-request `Layer` would rebuild the pool per request.
 */
export const makeMongoTenantResolver = (
  client: MongoClient,
  prefix: string,
): TenantDatabaseResolver<Db> => ({
  forOrganization: (organizationId: string) =>
    Effect.gen(function* () {
      if (!SAFE_ORGANIZATION_ID.test(organizationId)) {
        return yield* Effect.fail(
          new EntifixConnError(
            'Refusing to resolve a tenant database from an unsafe organization id',
            undefined,
            // The id itself is deliberately not logged: it arrived unvalidated.
            { prefix },
          ),
        );
      }

      const name = `${prefix}${organizationId}`;
      if (name.length > MAX_DB_NAME_LENGTH) {
        return yield* Effect.fail(
          new EntifixConnError(
            'Tenant database name exceeds the Mongo limit',
            undefined,
            { prefix, length: name.length },
          ),
        );
      }

      return client.db(name);
    }),
});
