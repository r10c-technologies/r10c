import { stubUriConfigurationLayer } from '@r10c/entifix-ts-testing-unit';
import {
  http,
  HttpResponse,
  setupEntifixServer,
} from '@r10c/entifix-ts-testing-unit/http';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { BuildEntityRestOptions } from '../entity-rest/types.js';
import { buildTransactionStatusReader } from './build-transaction-status-reader/build-transaction-status-reader.js';

const BASE_URL = 'http://service/api/transaction';
const TX = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

const options: BuildEntityRestOptions = {
  uriConfig: { key: 'service-domain.[entity]', group: 'uri' },
};

// The tracker is reached through the same config-driven URL composition every
// entity uses; `transaction` is simply the path segment.
const configuration = stubUriConfigurationLayer(
  { transaction: BASE_URL },
  { keyTemplate: 'service-domain.[entity]', group: 'uri' },
);

const server = setupEntifixServer();

const aRecord = (state: string) => ({
  meta: { type: 'transactionRecord', entity: 'widget' },
  data: {
    transactionId: TX,
    entity: 'widget',
    state,
    createdAt: '2026-07-20T12:00:00.000Z',
    updatedAt: '2026-07-20T12:00:01.000Z',
  },
});

const read = (transactionId = TX) =>
  Effect.runPromise(
    Effect.flatMap(buildTransactionStatusReader(options), reader =>
      reader.read(transactionId),
    ).pipe(Effect.provide(configuration)),
  );

describe('buildTransactionStatusReader', () => {
  it('reads a tracked record by its transaction id', async () => {
    server.use(http.get(`${BASE_URL}/${TX}`, () => HttpResponse.json(aRecord('COMPLETED'))));

    await expect(read()).resolves.toMatchObject({
      transactionId: TX,
      state: 'COMPLETED',
    });
  });

  it('carries a terminal failure through, reason and all', async () => {
    server.use(
      http.get(`${BASE_URL}/${TX}`, () =>
        HttpResponse.json({
          ...aRecord('FAILED'),
          data: { ...aRecord('FAILED').data, error: 'duplicate code' },
        }),
      ),
    );

    await expect(read()).resolves.toMatchObject({
      state: 'FAILED',
      error: 'duplicate code',
    });
  });

  // ⚠️ The rule the whole reconciliation turns on. `accepted` reaches the
  // tracker over the bus, so with the broker down the entity write commits while
  // no event is ever published and the tracker holds nothing. Answering
  // `undefined` is what keeps the caller waiting instead of un-rendering a write
  // that is about to appear (ADR 0043).
  it('answers undefined for an untracked id rather than failing', async () => {
    server.use(
      http.get(`${BASE_URL}/${TX}`, () =>
        HttpResponse.json({ error: 'transaction not found', code: 'notFound' }, { status: 404 }),
      ),
    );

    await expect(read()).resolves.toBeUndefined();
  });

  // Every other status stays an error, so a service that is down is not quietly
  // read as "no such transaction" — which would roll back every pending write
  // the moment the tracker became unreachable.
  it('fails on any status that is not 404', async () => {
    server.use(
      http.get(`${BASE_URL}/${TX}`, () =>
        HttpResponse.json({ error: 'boom' }, { status: 503 }),
      ),
    );

    await expect(read()).rejects.toThrow();
  });

  it('fails when the body is not a transaction envelope', async () => {
    server.use(
      http.get(`${BASE_URL}/${TX}`, () =>
        HttpResponse.json({
          meta: { type: 'entity', entity: 'widget' },
          data: { id: 'widget-1' },
        }),
      ),
    );

    await expect(read()).rejects.toThrow(/transactionRecord/);
  });
});
