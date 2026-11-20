import { generateKeyPairSync } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  CLUSTER_OTEL_ENDPOINT,
  CLUSTER_SECRETS,
  clusterRows,
  type ClusterSeedInputs,
  mongoSecretOf,
  seedRowsFor,
} from './cluster-seed.js';
import { SEED_ROWS } from './db.js';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PRIVATE_PEM = privateKey
  .export({ type: 'pkcs8', format: 'pem' })
  .toString();

const mongoServices = [
  ...new Set(
    SEED_ROWS.filter(
      row => row.group_name === 'mongo' && row.key === 'uri',
    ).map(row => row.service),
  ),
];

const inputs = (
  overrides: Partial<Record<string, string>> = {},
): ClusterSeedInputs => ({
  origins: {
    storefront: 'https://shop.example.test',
    backOffice: 'https://office.example.test',
    identity: 'https://id.example.test',
  },
  smtp: { host: 'smtp.example.test', port: '587', from: 'r10c <a@b.test>' },
  zitadelClientId: '123@r10c',
  secrets: {
    ...Object.fromEntries(
      CLUSTER_SECRETS.map(name => [name, `secret-${name}`]),
    ),
    ...Object.fromEntries(
      mongoServices.map(service => [
        mongoSecretOf(service),
        `mongodb+srv://${service}:pw@cluster.example.test/`,
      ]),
    ),
    'jwt-private-key': PRIVATE_PEM,
    ...overrides,
  } as Record<string, string>,
});

const find = (
  rows: ReturnType<typeof clusterRows>,
  service: string,
  group: string,
  key: string,
) =>
  rows.find(
    row =>
      row.service === service && row.group_name === group && row.key === key,
  )?.value;

describe('the cluster seed', () => {
  const rows = clusterRows(SEED_ROWS, inputs());

  it('rewrites every lab row and keeps every key', () => {
    expect(rows).toHaveLength(SEED_ROWS.length);
    expect(
      rows.map(({ service, group_name, key }) => [service, group_name, key]),
    ).toEqual(
      SEED_ROWS.map(({ service, group_name, key }) => [
        service,
        group_name,
        key,
      ]),
    );
  });

  it('keeps both halves of a crossing pair equal', () => {
    expect(find(rows, 'transaction-service', 'service', 'token')).toBe(
      'secret-flow-crossing-token',
    );
    for (const service of [
      'sales-service',
      'order-service',
      'fulfilment-service',
    ])
      expect(find(rows, service, 'transaction', 'crossingToken')).toBe(
        'secret-flow-crossing-token',
      );
    expect(find(rows, 'transaction-service', 'participant', 'orderToken')).toBe(
      find(rows, 'order-service', 'service', 'token'),
    );
  });

  it('gives each Mongo service its own user and every pod the node agent', () => {
    expect(find(rows, 'order-service', 'mongo', 'uri')).toContain(
      'order-service:',
    );
    expect(find(rows, 'auth-service', 'mongo', 'uri')).toContain(
      'auth-service:',
    );
    expect(
      rows
        .filter(row => row.group_name === 'otel' && row.key === 'endpoint')
        .every(row => row.value === CLUSTER_OTEL_ENDPOINT),
    ).toBe(true);
  });

  it('names services and origins the way the cluster does', () => {
    expect(find(rows, 'back-office-app', 'uri', 'order-service-domain')).toBe(
      'http://order-service:3105/api',
    );
    expect(find(rows, 'transaction-service', 'participant', 'stockUrl')).toBe(
      'http://stock-service:3108',
    );
    expect(find(rows, 'auth-service', 'zitadel', 'issuer')).toBe(
      'https://id.example.test',
    );
    expect(find(rows, 'auth-service', 'zitadel', 'redirectUri')).toBe(
      'https://office.example.test/api/auth/callback',
    );
    expect(find(rows, 'order-service', 'order', 'storefrontUrl')).toBe(
      'https://shop.example.test',
    );
  });

  it('derives the public key and its id from the private key', () => {
    const publicKey = find(rows, 'order-service', 'jwt', 'publicKey');
    expect(publicKey).toContain('BEGIN PUBLIC KEY');
    expect(find(rows, 'auth-service', 'jwt', 'publicKey')).toBe(publicKey);
    expect(find(rows, 'order-service', 'jwt', 'keyId')).toMatch(
      /^cluster-[0-9a-f]{12}$/,
    );
  });

  it('refuses a missing secret by name', () => {
    expect(() => clusterRows(SEED_ROWS, inputs({ 'redis-uri': '' }))).toThrow(
      '"redis-uri"',
    );
  });

  /** The plant: a lab row this module does not know is a refused boot. */
  it('refuses a row it cannot rewrite', () => {
    expect(() =>
      clusterRows(
        [
          ...SEED_ROWS,
          {
            service: 'courier-service',
            group_name: 'courier',
            key: 'url',
            value: 'http://localhost:3999/api',
          },
        ],
        inputs(),
      ),
    ).toThrow('courier-service / courier / url');
  });
});

describe('the seed profile', () => {
  it('is the lab unless the cluster says otherwise', () => {
    expect(seedRowsFor({}, SEED_ROWS)).toBe(SEED_ROWS);
    expect(() =>
      seedRowsFor({ CONFIG_SEED_PROFILE: 'prod' }, SEED_ROWS),
    ).toThrow('"lab" or "cluster"');
    expect(() =>
      seedRowsFor({ CONFIG_SEED_PROFILE: 'cluster' }, SEED_ROWS),
    ).toThrow('CONFIG_SEED_FILE');
  });

  it('reads a cluster’s inputs from the mounted file', () => {
    const rows = seedRowsFor(
      { CONFIG_SEED_PROFILE: 'cluster', CONFIG_SEED_FILE: '/seed/seed.json' },
      SEED_ROWS,
      path => {
        expect(path).toBe('/seed/seed.json');
        return JSON.stringify(inputs());
      },
    );
    expect(find([...rows], 'auth-service', 'redis', 'uri')).toBe(
      'secret-redis-uri',
    );
  });
});
