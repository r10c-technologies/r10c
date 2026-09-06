import { Context, Effect, Option } from 'effect';
import { describe, expect, it } from 'vitest';

import type { PendingTransaction, TransactionSink } from './transaction-sink.js';
import {
  NoopTransactionSink,
  TransactionSinkTag,
} from './transaction-sink.js';

const TX = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

const aPending = (): PendingTransaction => ({
  transactionId: TX,
  entity: 'product',
  at: '2026-07-20T12:00:00.000Z',
});

describe('NoopTransactionSink', () => {
  // The sink where nothing is watching: outside a mounted provider, and in every
  // caller that never opted into command creates. It has to swallow the
  // announcement rather than throw, because a create on a plain route is a
  // legitimate flow that simply gets no optimistic treatment.
  it('accepts an announcement and does nothing observable', () => {
    expect(() => {
      NoopTransactionSink.began(aPending());
    }).not.toThrow();
  });
});

describe('TransactionSinkTag', () => {
  // The tag is read with `serviceOption`, so both arms are real code paths a
  // caller takes rather than defensive branches: the adapter runs with a sink in
  // context and without one, and neither is an error.
  it('is absent when nothing provided it, which is not a failure', () => {
    const sink = Effect.runSync(Effect.serviceOption(TransactionSinkTag));

    expect(Option.isNone(sink)).toBe(true);
  });

  it('hands back whatever the composition root provided', () => {
    const announced: PendingTransaction[] = [];
    const recording: TransactionSink = {
      began: pending => {
        announced.push(pending);
      },
    };

    const sink = Effect.runSync(
      Effect.provide(
        Effect.serviceOption(TransactionSinkTag),
        Context.make(TransactionSinkTag, recording),
      ),
    );

    Option.getOrThrow(sink).began(aPending());

    expect(announced).toEqual([aPending()]);
  });
});
