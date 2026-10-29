import type { StoreFault } from '@entifix/core';
import { translateSqlError } from '@entifix/sql';
import {
  ConfigurationLookupTag,
  toConfigurationPlain,
} from '@r10c/business-ts-configuration';
import { Effect, Layer } from 'effect';
import { SqlClient } from 'effect/sql';

interface LookupRow {
  readonly group_name: string;
  readonly key: string;
  readonly value: string;
  readonly is_secret: boolean;
}

/**
 * A driver failure, as the store failure it is — `unavailable`, mostly. Both
 * statements are reads, which raise no unique violation, so it is a fault.
 */
const unavailable = (error: unknown) =>
  translateSqlError(error, 'configuration') as StoreFault;

/**
 * The lookup a booting service is served from, straight off the
 * `configuration` table — real values, secrets included, which is why it is
 * reached only behind the fleet's shared token.
 */
export const ConfigurationLookupLayer = Layer.effect(
  ConfigurationLookupTag,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    return {
      forService: service =>
        sql<LookupRow>`
          SELECT group_name, key, value, is_secret
          FROM configuration WHERE service = ${service}
        `.pipe(
          Effect.map(rows =>
            toConfigurationPlain(
              rows.map(row => ({
                groupName: row.group_name,
                key: row.key,
                value: row.value,
                isSecret: row.is_secret,
              })),
            ),
          ),
          Effect.mapError(unavailable),
        ),
      stats: () =>
        Effect.all([
          sql<{
            count: number;
          }>`SELECT COUNT(*)::int AS count FROM configuration`,
          sql<{
            service: string;
          }>`SELECT DISTINCT service FROM configuration ORDER BY service`,
        ]).pipe(
          Effect.map(([counts, services]) => ({
            rowCount: counts[0]?.count ?? 0,
            services: services.map(row => row.service),
          })),
          Effect.mapError(unavailable),
        ),
    };
  }),
);
