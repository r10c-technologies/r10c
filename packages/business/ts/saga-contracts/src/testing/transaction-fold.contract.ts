import type {
  TransactionEvent,
  TransactionRecord,
} from '@entifix/transactions';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { TransactionFold } from '../transaction-fold.js';

/** A fold under test, and a way to read the record it folds into. */
export interface TransactionFoldSubject {
  readonly fold: TransactionFold;
  readonly recordOf: (
    transactionId: string,
  ) => Promise<TransactionRecord | undefined>;
}

const event = (
  state: TransactionEvent['state'],
  at: string,
  extra: Partial<TransactionEvent> = {},
): TransactionEvent =>
  ({
    transactionId: 't-1',
    entity: 'product-specification',
    state,
    step: state === 'PENDING' ? 'accepted' : 'completed',
    at,
    ...extra,
  }) as TransactionEvent;

/**
 * What every {@link TransactionFold} must guarantee: an event is folded once
 * per consumer however often it is delivered, a record is created by its first
 * event and moved by each later one (events for one transaction arrive in
 * publish order), and what an event says it carries — the code, the entity
 * id, the error, the organization — lands on the record.
 *
 * `make` returns a fresh, empty fold.
 */
export const describeTransactionFoldContract = (
  name: string,
  make: () => TransactionFoldSubject | Promise<TransactionFoldSubject>,
) => {
  describe(`${name} honours the TransactionFold contract`, () => {
    const fold = (
      { fold: subject }: TransactionFoldSubject,
      eventId: string,
      folded: TransactionEvent,
      consumer = 'tracker',
    ) => Effect.runPromise(subject.fold(consumer, eventId, folded));

    it('creates a record on the first event, and moves it on the next', async () => {
      const subject = await make();

      await fold(
        subject,
        'e-1',
        event('PENDING', '2026-10-25T10:00:00.000Z', {
          organizationId: 'acme',
        }),
      );
      await fold(
        subject,
        'e-2',
        event('COMPLETED', '2026-10-25T10:00:01.000Z', {
          code: 'product-001',
          entityId: 't-1',
        }),
      );

      expect(await subject.recordOf('t-1')).toMatchObject({
        transactionId: 't-1',
        entity: 'product-specification',
        state: 'COMPLETED',
        code: 'product-001',
        entityId: 't-1',
        organizationId: 'acme',
        createdAt: '2026-10-25T10:00:00.000Z',
        updatedAt: '2026-10-25T10:00:01.000Z',
      });
    });

    it('folds a redelivery not at all, per consumer', async () => {
      const subject = await make();

      const first = await fold(
        subject,
        'e-1',
        event('FAILED', '2026-10-25T10:00:00.000Z', { error: 'disk full' }),
      );
      const again = await fold(
        subject,
        'e-1',
        event('COMPLETED', '2026-10-25T10:00:09.000Z'),
      );
      const elsewhere = await fold(
        subject,
        'e-1',
        event('FAILED', '2026-10-25T10:00:00.000Z', { error: 'disk full' }),
        'another',
      );

      expect([first, again, elsewhere]).toEqual([
        'claimed',
        'duplicate',
        'claimed',
      ]);
      expect(await subject.recordOf('t-1')).toMatchObject({
        state: 'FAILED',
        error: 'disk full',
      });
    });

    it('knows no transaction it was never told about', async () => {
      const subject = await make();

      expect(await subject.recordOf('nobody')).toBeUndefined();
    });
  });
};
