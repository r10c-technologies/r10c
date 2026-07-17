import { HttpRouter, HttpServerResponse } from '@effect/platform';
import { SqlClient, SqlError } from '@effect/sql';
import { ConfigurationPlain } from '@r10c/entifix-ts-core';
import { redactValue } from '@r10c/shells-effect-service';
import { Effect } from 'effect';

import { ConfigurationRow } from './db';

const DEFAULT_PG_URL = 'postgres://postgres:postgres@127.0.0.1:30432/postgres';

/** Turns flat `configuration` rows into the `ConfigurationPlain` contract. */
function toConfigurationPlain(
  rows: ReadonlyArray<Pick<ConfigurationRow, 'group_name' | 'key' | 'value'>>
): ConfigurationPlain {
  const plain: ConfigurationPlain = {};
  for (const row of rows) {
    (plain[row.group_name] ??= []).push({ key: row.key, value: row.value });
  }
  return plain;
}

const onSqlError = (error: SqlError.SqlError) =>
  HttpServerResponse.json(
    { error: 'configuration store unavailable', detail: error.message },
    { status: 500 }
  );

/**
 * config-service routes. `/api/health` is added by the service base.
 *
 * - `GET /api/config/:service` — the consumer lookup: every configuration row
 *   for that service, grouped into `ConfigurationPlain` from Postgres.
 * - `GET /api/config` — introspection: this service's own loaded parameters
 *   (redacted Postgres URL, row count, and the services present in the table).
 */
export const router = HttpRouter.empty.pipe(
  HttpRouter.get(
    '/api/config',
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const counts = yield* sql<{
        count: number;
      }>`SELECT COUNT(*)::int AS count FROM configuration`;
      const services = yield* sql<{
        service: string;
      }>`SELECT DISTINCT service FROM configuration ORDER BY service`;

      return yield* HttpServerResponse.json({
        service: '@r10c/config-service',
        store: 'postgres',
        pgUrl: redactValue(process.env.CONFIG_PG_URL ?? DEFAULT_PG_URL),
        rowCount: counts[0]?.count ?? 0,
        services: services.map((row) => row.service),
      });
    }).pipe(Effect.catchTag('SqlError', onSqlError))
  ),
  HttpRouter.get(
    '/api/config/:service',
    Effect.gen(function* () {
      const params = yield* HttpRouter.params;
      const service = params.service ?? '';
      const sql = yield* SqlClient.SqlClient;

      const rows = yield* sql<
        Pick<ConfigurationRow, 'group_name' | 'key' | 'value'>
      >`SELECT group_name, key, value FROM configuration WHERE service = ${service}`;

      return yield* HttpServerResponse.json(toConfigurationPlain(rows));
    }).pipe(Effect.catchTag('SqlError', onSqlError))
  )
);
