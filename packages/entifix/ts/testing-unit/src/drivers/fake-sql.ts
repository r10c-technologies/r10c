/**
 * A fake of the `@effect/sql` driver, not of the repository port.
 *
 * It sits one level *below* `makeSqlRepository`, so the adapter's own code — the
 * filter translation, the clause assembly, the upsert rule, the error mapping —
 * actually runs and is measured by coverage. A fake at the port level would skip
 * all of it. Same reasoning as {@link makeFakeMongoDb}.
 *
 * What it does **not** do is execute SQL: it hands back canned rows and records
 * the statement each call compiled to, so a spec asserts on the SQL and
 * parameters the adapter produced. Running the shared
 * `describeEntityRepositoryContract` needs a real engine and belongs against real
 * Postgres, the way the driver connection Layers are covered.
 */

import { SqlError } from '@effect/sql';
import * as Statement from '@effect/sql/Statement';
import { Effect } from 'effect';

/** One statement the adapter executed, already compiled. */
export interface FakeSqlExecution {
  /** The compiled SQL text, parameters replaced by `$1`, `$2`, … */
  readonly sql: string;
  readonly params: ReadonlyArray<unknown>;
}

/** Rows to answer with when a statement's SQL contains `match`. */
export interface FakeSqlResponse {
  readonly match: string;
  readonly rows: ReadonlyArray<Record<string, unknown>>;
}

export interface FakeSqlClient {
  /**
   * Answers `rows` for any statement whose compiled SQL contains `match`. Later
   * registrations win, so a spec can override a default set up by a helper.
   */
  respondTo(match: string, rows: ReadonlyArray<Record<string, unknown>>): void;
  /**
   * Makes every subsequent execution fail, so the adapter's `EntifixConnError`
   * mapping is reachable.
   */
  failWith(message: string): void;
  /**
   * Makes only the statements containing `match` fail, leaving the rest working
   * — the way a select that succeeds and a count that then fails reaches a
   * distinct error branch.
   */
  failOn(match: string, message: string): void;
  /** Every statement executed, in order, for assertions about what ran. */
  readonly executions: ReadonlyArray<FakeSqlExecution>;
  /** The most recently executed statement. */
  readonly lastExecution: FakeSqlExecution | undefined;
  /**
   * The object to hand to `makeSqlRepository` in place of a real `SqlClient`.
   *
   * Typed `unknown` on purpose — casting at the call site keeps this fake honest
   * that it implements only the constructor surface the adapters use, not the
   * whole `SqlClient` (no transactions, no reactivity, no streaming).
   */
  readonly client: unknown;
}

const unsupported = (name: string): never => {
  throw new TypeError(`fake sql: ${name} is not implemented`);
};

/**
 * The Postgres compiler's configuration, mirrored from `@effect/sql-pg` so the
 * fake emits exactly the dialect production does — `$n` placeholders and
 * double-quoted identifiers — without this package depending on the `pg` driver.
 *
 * `sql.updateValues` and the `PgJson` custom segment are deliberate `TypeError`s
 * rather than approximations: no adapter uses either, and a compiler that
 * half-emitted them would let a spec pass on SQL that real Postgres rejects.
 */
const pgCompiler = Statement.makeCompiler({
  dialect: 'pg',
  placeholder: index => `$${index}`,
  onIdentifier: Statement.defaultEscape('"'),
  onRecordUpdate: () => unsupported('updateValues'),
  onCustom: () => unsupported('custom segments'),
});

/** Builds an in-memory stand-in for an `@effect/sql` client. */
export const makeFakeSqlClient = (
  seed: ReadonlyArray<FakeSqlResponse> = [],
): FakeSqlClient => {
  const responses: FakeSqlResponse[] = [...seed];
  const executions: FakeSqlExecution[] = [];
  const failuresByMatch: Array<{ match: string; message: string }> = [];
  let failure: string | undefined;

  const answer = (sql: string) => {
    // Last registration wins, so an override does not have to remove the
    // default it replaces.
    for (let index = responses.length - 1; index >= 0; index -= 1) {
      const response = responses[index];
      if (response !== undefined && sql.includes(response.match)) {
        return response.rows;
      }
    }
    return [];
  };

  const execute = (sql: string, params: ReadonlyArray<unknown>) => {
    executions.push({ sql, params });

    const scoped = failuresByMatch.find(entry => sql.includes(entry.match));
    const message = scoped?.message ?? failure;
    if (message !== undefined) {
      return Effect.fail(
        new SqlError.SqlError({ cause: new Error(message), message }),
      );
    }
    return Effect.succeed(answer(sql));
  };

  const connection = {
    execute: (sql: string, params: ReadonlyArray<unknown>) =>
      execute(sql, params),
    executeUnprepared: (sql: string, params: ReadonlyArray<unknown>) =>
      execute(sql, params),
    executeRaw: (sql: string, params: ReadonlyArray<unknown>) =>
      execute(sql, params),
    executeValues: () => unsupported('executeValues'),
    executeStream: () => unsupported('executeStream'),
  };

  return {
    respondTo: (match, rows) => {
      responses.push({ match, rows });
    },
    failWith: message => {
      failure = message;
    },
    failOn: (match, message) => {
      failuresByMatch.push({ match, message });
    },
    get executions() {
      return executions;
    },
    get lastExecution() {
      return executions[executions.length - 1];
    },
    client: Statement.make(
      Effect.succeed(connection) as never,
      pgCompiler,
      [],
      undefined,
    ),
  };
};
