/**
 * What the fleet holds, counted at `down` and compared at the end of the next
 * `up` (#705, ADR 0083 §5): a down that lost a record is found by the up that
 * follows it, not by a person days later.
 *
 * The counts are taken **inside the cluster**, by one pod with a container per
 * engine, because that is where the databases answer: Atlas admits only the
 * cluster's NAT address, and Cloud SQL and Redis have no public address at
 * all. The pod reads its connection strings from a Secret this step applies
 * over stdin and deletes again, so no credential is ever in a command line.
 *
 * A census holds counts, never contents. Redis key names can carry a session
 * id, so each is kept as its SHA-1 — computed by Redis itself — with the
 * instant it expires.
 */
import type { Io } from './io.js';

export interface Census {
  /** When it was taken, in ms since the epoch. */
  readonly takenAt: number;
  /** Documents per collection, per database. */
  readonly mongo: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /** Rows per table, per Postgres database (`config`, `workflow`). */
  readonly sql: Readonly<Record<string, Readonly<Record<string, number>>>>;
  /** Each Redis key's SHA-1, and when it expires (`null`: never). */
  readonly redis: Readonly<Record<string, number | null>>;
  /** The broker's durable queues, by name. */
  readonly queues: readonly string[];
  /**
   * Objects in the payment-evidence store; absent where that store is a
   * directory inside the pod, which the environment declares gone with it.
   */
  readonly objects?: number;
}

/** Where the census pod connects, applied as a Secret and deleted after. */
export interface CensusSources {
  readonly namespace: string;
  readonly mongoUri: string;
  readonly configUrl: string;
  readonly workflowUrl: string;
  readonly redisHost: string;
  readonly redisPassword: string;
  /** The receipts bucket, counted from the operator's machine. */
  readonly bucket: string | undefined;
}

/** The images the fleet already runs, so a census pulls nothing new. */
export const CENSUS_IMAGES = {
  mongo: 'mongo:7.0',
  postgres: 'postgres:16',
  redis: 'redis:7.4.7',
} as const;

const POD = 'r10c-census';
const SECRET = 'r10c-census';
const BROKER = 'rabbitmq-server-0';

const MONGO_SCRIPT = `
const out = {};
for (const { name } of db.adminCommand({ listDatabases: 1, nameOnly: true }).databases) {
  if (['admin', 'local', 'config'].includes(name)) continue;
  const database = db.getSiblingDB(name);
  out[name] = {};
  for (const { name: collection } of database.getCollectionInfos({ type: 'collection' }, { nameOnly: true, authorizedCollections: true })) {
    if (collection.startsWith('system.')) continue;
    out[name][collection] = database.getCollection(collection).countDocuments({});
  }
}
print('CENSUS ' + JSON.stringify(out));
`;

const SQL_COUNT = `SELECT coalesce(json_object_agg(table_schema || '.' || table_name,
  (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', table_schema, table_name), false, true, '')))[1]::text::bigint), '{}')
FROM information_schema.tables
WHERE table_type = 'BASE TABLE'
  AND table_schema NOT IN ('pg_catalog', 'information_schema')
  AND has_table_privilege(format('%I.%I', table_schema, table_name), 'SELECT')`;

const REDIS_SCRIPT = `
local out, cursor = {}, '0'
repeat
  local page = redis.call('SCAN', cursor, 'COUNT', 1000)
  cursor = page[1]
  for _, key in ipairs(page[2]) do out[redis.sha1hex(key)] = redis.call('PTTL', key) end
until cursor == '0'
if next(out) == nil then return '{}' end
return cjson.encode(out)
`;

const secretManifest = (sources: CensusSources): string =>
  JSON.stringify({
    apiVersion: 'v1',
    kind: 'Secret',
    metadata: { name: SECRET, namespace: sources.namespace },
    type: 'Opaque',
    stringData: {
      MONGO_URI: sources.mongoUri,
      CONFIG_URL: sources.configUrl,
      WORKFLOW_URL: sources.workflowUrl,
      // redis-cli reads its password from here; `-u` with a password-only
      // URI reached the server unauthenticated (measured: NOAUTH).
      REDISCLI_AUTH: sources.redisPassword,
    },
  });

const fromSecret = (...keys: string[]) =>
  keys.map(key => ({
    name: key,
    valueFrom: { secretKeyRef: { name: SECRET, key } },
  }));

const container = (
  name: string,
  image: string,
  script: string,
  command: string,
  secrets: string[],
) => ({
  name,
  image,
  command: ['sh', '-c', command],
  env: [{ name: 'SCRIPT', value: script }, ...fromSecret(...secrets)],
  resources: { requests: { cpu: '50m', memory: '64Mi' } },
});

/** The census pod: one container per engine, each printing `CENSUS <json>`. */
export const podManifest = (namespace: string, redisHost: string): string =>
  JSON.stringify({
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: { name: POD, namespace, labels: { app: POD } },
    spec: {
      restartPolicy: 'Never',
      containers: [
        container(
          'mongo',
          CENSUS_IMAGES.mongo,
          MONGO_SCRIPT,
          'mongosh "$MONGO_URI" --quiet --eval "$SCRIPT"',
          ['MONGO_URI'],
        ),
        container(
          'postgres',
          CENSUS_IMAGES.postgres,
          SQL_COUNT,
          'set -e; echo "CENSUS config $(psql "$CONFIG_URL" -Atc "$SCRIPT")"; echo "CENSUS workflow $(psql "$WORKFLOW_URL" -Atc "$SCRIPT")"',
          ['CONFIG_URL', 'WORKFLOW_URL'],
        ),
        container(
          'redis',
          CENSUS_IMAGES.redis,
          REDIS_SCRIPT,
          `echo "CENSUS $(redis-cli -h ${redisHost} --no-auth-warning --raw EVAL "$SCRIPT" 0)"`,
          ['REDISCLI_AUTH'],
        ),
      ],
    },
  });

/** The `CENSUS …` lines a container printed, without the marker. */
export const censusLines = (log: string): string[] =>
  log
    .split('\n')
    .filter(line => line.startsWith('CENSUS '))
    .map(line => line.slice('CENSUS '.length));

/** The one `CENSUS` line a container printed, parsed — or what it said instead. */
const parsed = <T>(log: string, what: string): T => {
  const [line] = censusLines(log);
  try {
    if (line === undefined) throw new Error('no line');
    return JSON.parse(line) as T;
  } catch {
    throw new Error(
      `the census read no ${what}: ${(line ?? log).trim().slice(0, 200)}`,
    );
  }
};

/** The broker's durable queues, from `rabbitmqctl … --formatter json`. */
export const durableQueues = (json: string): string[] =>
  (
    JSON.parse(json === '' ? '[]' : json) as {
      name: string;
      durable: boolean;
    }[]
  )
    .filter(queue => queue.durable)
    .map(queue => queue.name)
    .sort();

/** Redis's `{sha1: pttl}` as absolute expiries: `-1` never expires. */
export const expiries = (
  pttl: Readonly<Record<string, number>>,
  takenAt: number,
): Record<string, number | null> =>
  Object.fromEntries(
    Object.entries(pttl).map(([key, ms]) => [
      key,
      ms < 0 ? null : takenAt + ms,
    ]),
  );

export const takeCensus = (
  io: Io,
  sources: CensusSources,
  now: () => number = Date.now,
): Census => {
  const kubectl = (...args: string[]) =>
    io.run(['kubectl', '-n', sources.namespace, ...args], { capture: true });
  const remove = () => {
    io.run(
      [
        'kubectl',
        '-n',
        sources.namespace,
        'delete',
        'pod',
        POD,
        '--ignore-not-found',
        '--wait=false',
      ],
      { capture: true, allowFailure: true },
    );
    io.run(
      [
        'kubectl',
        '-n',
        sources.namespace,
        'delete',
        'secret',
        SECRET,
        '--ignore-not-found',
      ],
      { capture: true, allowFailure: true },
    );
  };
  // A pod left by an interrupted census would refuse the new one.
  remove();
  try {
    io.run(['kubectl', 'apply', '-f', '-'], {
      input: secretManifest(sources),
      capture: true,
    });
    io.run(['kubectl', 'apply', '-f', '-'], {
      input: podManifest(sources.namespace, sources.redisHost),
      capture: true,
    });
    const done = io.run(
      [
        'kubectl',
        '-n',
        sources.namespace,
        'wait',
        '--for=jsonpath={.status.phase}=Succeeded',
        `pod/${POD}`,
        '--timeout=5m',
      ],
      { capture: true, allowFailure: true },
    );
    const logs = (name: string) =>
      io.run(['kubectl', '-n', sources.namespace, 'logs', POD, '-c', name], {
        capture: true,
        allowFailure: true,
      }).stdout;
    if (!done.ok)
      throw new Error(
        `the census pod did not finish:\n${['mongo', 'postgres', 'redis']
          .map(name => `  ${name}: ${logs(name).trim().slice(-400)}`)
          .join('\n')}`,
      );
    const takenAt = now();
    const sql = Object.fromEntries(
      censusLines(logs('postgres')).map(line => {
        const space = line.indexOf(' ');
        return [
          line.slice(0, space),
          JSON.parse(line.slice(space + 1)) as Record<string, number>,
        ];
      }),
    );
    if (sql['config'] === undefined || sql['workflow'] === undefined)
      throw new Error('the census read no Postgres counts');
    const queues = durableQueues(
      kubectl(
        'exec',
        BROKER,
        '-c',
        'rabbitmq',
        '--',
        'rabbitmqctl',
        'list_queues',
        'name',
        'durable',
        '--formatter',
        'json',
        '--quiet',
      ).stdout.trim(),
    );
    const objects =
      sources.bucket === undefined
        ? undefined
        : io
            .run(
              [
                'gcloud',
                'storage',
                'ls',
                '--recursive',
                `gs://${sources.bucket}/**`,
              ],
              // An empty bucket matches no URL, which gcloud reports as a failure.
              { capture: true, allowFailure: true },
            )
            .stdout.split('\n')
            .filter(line => line.trim() !== '').length;
    return {
      takenAt,
      mongo: parsed<Census['mongo']>(logs('mongo'), 'Mongo counts'),
      sql,
      redis: expiries(
        parsed<Record<string, number>>(logs('redis'), 'Redis keys'),
        takenAt,
      ),
      queues,
      ...(objects === undefined ? {} : { objects }),
    };
  } finally {
    remove();
  }
};

/**
 * What may legitimately hold fewer rows after a down and an up, each with the
 * reason. Anything else that shrinks is a loss.
 */
export const TRANSIENT: readonly (readonly [RegExp, string])[] = [];

const transient = (key: string) =>
  TRANSIENT.some(([pattern]) => pattern.test(key));

const counted = (
  engine: string,
  before: Census['mongo'],
  after: Census['mongo'],
): string[] =>
  Object.entries(before).flatMap(([database, tables]) => {
    const now = after[database];
    if (now === undefined)
      return [`${engine} ${database}: the database is gone`];
    return Object.entries(tables).flatMap(([table, count]) => {
      const key = `${engine} ${database}.${table}`;
      const left = now[table];
      if (left === undefined)
        return transient(key) ? [] : [`${key}: gone (held ${String(count)})`];
      return left < count && !transient(key)
        ? [`${key}: ${String(count)} → ${String(left)}`]
        : [];
    });
  });

/** Every loss between a census taken at down and one taken at the next up. */
export const diffCensus = (before: Census, after: Census): string[] => {
  const keysGone = Object.entries(before.redis).filter(
    ([key, expires]) =>
      !(key in after.redis) && (expires === null || expires > after.takenAt),
  ).length;
  return [
    ...counted('mongo', before.mongo, after.mongo),
    ...counted('postgres', before.sql, after.sql),
    ...(keysGone > 0
      ? [`redis: ${String(keysGone)} keys gone before they were due to expire`]
      : []),
    ...before.queues
      .filter(queue => !after.queues.includes(queue))
      .map(queue => `rabbitmq ${queue}: the queue is gone`),
    ...(before.objects !== undefined &&
    after.objects !== undefined &&
    after.objects < before.objects
      ? [
          `payment-evidence: ${String(before.objects)} → ${String(after.objects)} objects`,
        ]
      : []),
  ];
};

/** One line saying what a census holds. */
export const summary = (census: Census): string => {
  const collections = Object.values(census.mongo).reduce(
    (sum, tables) => sum + Object.keys(tables).length,
    0,
  );
  const documents = Object.values(census.mongo).reduce(
    (sum, tables) => sum + Object.values(tables).reduce((a, b) => a + b, 0),
    0,
  );
  const rows = Object.values(census.sql).reduce(
    (sum, tables) => sum + Object.values(tables).reduce((a, b) => a + b, 0),
    0,
  );
  return [
    `${String(documents)} documents in ${String(collections)} collections`,
    `${String(rows)} rows`,
    `${String(Object.keys(census.redis).length)} keys`,
    `${String(census.queues.length)} durable queues`,
    ...(census.objects === undefined
      ? []
      : [`${String(census.objects)} receipts`]),
  ].join(', ');
};
