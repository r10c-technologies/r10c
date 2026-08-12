import {
  describeEntityColumns,
  deserializeSingleEntity,
  serializeEntity,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { SettlementRun } from './settlement-run.entity.js';

const MARCH_START = new Date('2026-03-01T00:00:00.000Z');
const MARCH_END = new Date('2026-03-31T23:59:59.000Z');

describe('SettlementRun', () => {
  it('serializes the period it covers and where it has got to', () => {
    const run = new SettlementRun(MARCH_START, MARCH_END);
    run.id = 'run-1';
    run.status = 'calculated';

    expect(serializeEntity(SettlementRun, run)).toEqual({
      id: 'run-1',
      periodStart: MARCH_START,
      periodEnd: MARCH_END,
      status: 'calculated',
    });
  });

  it('rebuilds itself from a stored record', async () => {
    const run = await Effect.runPromise(
      deserializeSingleEntity(SettlementRun, {
        id: 'run-2',
        periodStart: MARCH_START,
        periodEnd: MARCH_END,
        status: 'paid',
      }),
    );

    expect(run?.status).toBe('paid');
    expect(run?.periodStart).toEqual(MARCH_START);
  });

  it('opens with no period and nothing calculated', () => {
    const run = new SettlementRun();

    expect(run.periodStart).toBeUndefined();
    expect(run.periodEnd).toBeUndefined();
    expect(run.status).toBe('open');
  });

  it('accepts the setters a repository writes back through', () => {
    const run = new SettlementRun();
    run.periodStart = MARCH_START;
    run.periodEnd = MARCH_END;
    run.status = 'cancelled';

    expect(run.periodStart).toEqual(MARCH_START);
    expect(run.periodEnd).toEqual(MARCH_END);
    expect(run.status).toBe('cancelled');
  });

  it('is a record rather than a job invocation', () => {
    // A cron job writing payouts directly would leave no answer to "what did
    // the March run mean?" once March's data changed. The period is on the
    // entity precisely so that question stays answerable.
    const names = describeEntityColumns(SettlementRun).map(
      column => column.name,
    );

    expect(names).toEqual(['id', 'periodStart', 'periodEnd', 'status']);
  });

  it('lets a period be found by date on both ends', () => {
    const byName = new Map(
      describeEntityColumns(SettlementRun).map(column => [column.name, column]),
    );

    expect(byName.get('periodStart')?.filterable).toBe(true);
    expect(byName.get('periodEnd')?.filterable).toBe(true);
    expect(byName.get('status')?.filterable).toBe(true);
  });
});
