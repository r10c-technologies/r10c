import type { ConfigurationRow } from '@r10c/shells-effect-config';
import {
  flowParticipants,
  PARTICIPANT_DIALS,
  PARTICIPANT_DIALS_GROUP,
  participantDialKey,
} from '@r10c/shells-effect-flow-catalog';
import { describe, expect, it } from 'vitest';

import { SEED_ROWS } from './db.js';

/**
 * Every `<participant>.<dial>` transaction-service would read and the seed
 * does not hold. transaction-service reads each with a required getter, so a
 * missing one is a boot that dies — this names it at build time instead.
 */
const missingDials = (
  rows: ReadonlyArray<ConfigurationRow>,
  participants: readonly string[],
) => {
  const seeded = new Set(
    rows
      .filter(
        row =>
          row.service === 'transaction-service' &&
          row.group_name === PARTICIPANT_DIALS_GROUP,
      )
      .map(row => row.key),
  );
  return participants.flatMap(participant =>
    PARTICIPANT_DIALS.map(dial => participantDialKey(participant, dial)).filter(
      key => !seeded.has(key),
    ),
  );
};

describe('the seed', () => {
  it('holds every dial for every participant a registered flow calls', () => {
    expect(flowParticipants().length).toBeGreaterThan(0);
    expect(missingDials(SEED_ROWS, flowParticipants())).toEqual([]);
  });

  /** The plants: the check above is only worth something if these fail it. */
  it('names a participant no row was seeded for, and a dial dropped from one', () => {
    expect(
      missingDials(SEED_ROWS, [...flowParticipants(), 'courier-service']),
    ).toEqual(
      PARTICIPANT_DIALS.map(dial =>
        participantDialKey('courier-service', dial),
      ),
    );
    expect(
      missingDials(
        SEED_ROWS.filter(row => row.key !== 'stock-service.stepBoundMs'),
        flowParticipants(),
      ),
    ).toEqual(['stock-service.stepBoundMs']);
  });

  it('seeds the workflow store and its runners beside the saga rows', () => {
    const transaction = SEED_ROWS.filter(
      row => row.service === 'transaction-service',
    );
    const value = (group: string, key: string) =>
      transaction.find(row => row.group_name === group && row.key === key);

    expect(value('workflow', 'url')).toMatchObject({
      value: 'postgres://postgres:postgres@127.0.0.1:30432/workflow',
      is_secret: true,
    });
    expect(value('workflow', 'runnerHost')?.value).toBe('127.0.0.1');
    expect(value('flow', 'concurrency')?.value).toBe('4');
    expect(value('outbox', 'maxAttempts')?.value).toBe('5');
  });
});
