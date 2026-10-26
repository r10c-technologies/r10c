import { EntifixConnError } from '@entifix/core';
import { Effect, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { Payment } from '../entities/payment/index.js';
import { Refund } from '../entities/refund/index.js';
import { type PaymentLedger, PaymentLedgerTag } from '../ports/payment-ledger.js';
import {
  type PaymentProvider,
  PaymentProviderTag,
} from '../ports/payment-provider.js';
import {
  capturePayment,
  PaymentRefused,
  refundPayment,
} from './take-payment.js';

/** A ledger over two maps, recording what it was asked to write. */
const ledgerOver = (options: { race?: boolean } = {}) => {
  const payments = new Map<string, Payment>();
  const refunds = new Map<string, Refund>();
  const byCommand = new Map<string, Payment | Refund>();
  const announced: string[] = [];
  const ledger: PaymentLedger = {
    decidedPayment: commandId =>
      Effect.succeed(
        Option.fromUndefinedOr(byCommand.get(commandId) as Payment | undefined),
      ),
    decidedRefund: commandId =>
      Effect.succeed(
        Option.fromUndefinedOr(byCommand.get(commandId) as Refund | undefined),
      ),
    captureFor: orderId =>
      Effect.succeed(
        [...payments.values()].find(
          payment =>
            payment.orderId === orderId && payment.status === 'captured',
        ),
      ),
    refundFor: paymentId =>
      Effect.succeed(
        [...refunds.values()].find(refund => refund.paymentId === paymentId),
      ),
    recordCapture: (payment, outcome, commandId) =>
      Effect.sync(() => {
        payments.set(String(payment.id), payment);
        if (commandId) byCommand.set(commandId, payment);
        announced.push(`${payment.status} ${outcome.orderId}`);
        return { _tag: 'recorded' as const, record: payment };
      }),
    recordRefund: (refund, outcome, commandId) =>
      Effect.sync(() => {
        if (options.race) {
          return { _tag: 'replayed' as const, record: refund };
        }
        refunds.set(String(refund.id), refund);
        if (commandId) byCommand.set(commandId, refund);
        announced.push(`refund ${refund.status} ${outcome.paymentId}`);
        return { _tag: 'recorded' as const, record: refund };
      }),
  };
  return { ledger, payments, announced };
};

const provider = (declines = false): PaymentProvider & { calls: number } => {
  const calls = { calls: 0 };
  return Object.assign(calls, {
    authorize: () => Effect.die('unused'),
    capture: () =>
      Effect.sync(() => {
        calls.calls += 1;
        return declines
          ? { status: 'failed' as const, failureReason: 'insufficient funds' }
          : { status: 'captured' as const, providerReference: 'ref-1' };
      }),
    refund: () =>
      Effect.sync(() => {
        calls.calls += 1;
        return declines
          ? { status: 'failed' as const, failureReason: 'too late' }
          : { status: 'refunded' as const, providerReference: 'ref-2' };
      }),
  });
};

const aPayment = (amount = 40) =>
  Object.assign(new Payment(), {
    orderId: 'order-1',
    amount,
    currency: 'GTQ',
    paymentMethod: 'card',
  });

const run = <A, E>(
  effect: Effect.Effect<A, E, PaymentLedgerTag | PaymentProviderTag>,
  ledger: PaymentLedger,
  money: PaymentProvider,
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(PaymentLedgerTag, ledger),
          Layer.succeed(PaymentProviderTag, money),
        ),
      ),
    ),
  );

describe('capturePayment', () => {
  it('captures, records the decision and announces it', async () => {
    const { ledger, announced } = ledgerOver();
    const money = provider();

    const result = await run(
      capturePayment({ payment: aPayment(), commandId: 'cmd-1' }),
      ledger,
      money,
    );

    expect(result._tag).toBe('captured');
    expect(announced).toEqual(['captured order-1']);
  });

  it('answers a redelivered command with the first decision, and never charges again', async () => {
    const { ledger } = ledgerOver();
    const money = provider();
    await run(
      capturePayment({ payment: aPayment(), commandId: 'cmd-2' }),
      ledger,
      money,
    );

    const again = await run(
      capturePayment({ payment: aPayment(), commandId: 'cmd-2' }),
      ledger,
      money,
    );

    expect(again._tag).toBe('replayed');
    expect(money.calls).toBe(1);
  });

  it('records a declined capture, and answers it declined', async () => {
    const { ledger, announced } = ledgerOver();

    const result = await run(
      capturePayment({ payment: aPayment(), commandId: undefined }),
      ledger,
      provider(true),
    );

    expect(result).toMatchObject({
      _tag: 'declined',
      reason: 'insufficient funds',
    });
    expect(announced).toEqual(['failed order-1']);
  });

  it('refuses a payment for nothing before any money moves', async () => {
    const { ledger } = ledgerOver();
    const money = provider();

    const refused = await run(
      Effect.flip(
        capturePayment({ payment: aPayment(0), commandId: undefined }),
      ),
      ledger,
      money,
    );

    expect(refused).toBeInstanceOf(PaymentRefused);
    expect(money.calls).toBe(0);
  });

  it('answers a capture the ledger found already recorded as replayed', async () => {
    const { ledger } = ledgerOver();
    const replaying: PaymentLedger = {
      ...ledger,
      recordCapture: payment =>
        Effect.succeed({ _tag: 'replayed' as const, record: payment }),
    };

    const result = await run(
      capturePayment({ payment: aPayment(), commandId: 'cmd-3' }),
      replaying,
      provider(),
    );

    expect(result._tag).toBe('replayed');
  });
});

describe('refundPayment', () => {
  const paid = async () => {
    const state = ledgerOver();
    await run(
      capturePayment({ payment: aPayment(), commandId: undefined }),
      state.ledger,
      provider(),
    );
    return state;
  };

  it('refunds the capture behind an order, for the capture’s amount', async () => {
    const { ledger, announced } = await paid();

    const result = await run(
      refundPayment({ orderId: 'order-1', commandId: 'r-1' }),
      ledger,
      provider(),
    );

    expect(result._tag).toBe('refunded');
    expect(result.refund.amount).toBe(40);
    expect(announced.at(-1)).toMatch(/^refund refunded /);
  });

  it('never refunds twice: a redelivery and a second command both replay, and the provider is not called', async () => {
    const { ledger } = await paid();
    const money = provider();
    await run(
      refundPayment({ orderId: 'order-1', commandId: 'r-2' }),
      ledger,
      money,
    );

    const redelivered = await run(
      refundPayment({ orderId: 'order-1', commandId: 'r-2' }),
      ledger,
      money,
    );
    const secondCommand = await run(
      refundPayment({ orderId: 'order-1', commandId: 'r-3' }),
      ledger,
      money,
    );

    expect(redelivered._tag).toBe('replayed');
    expect(secondCommand._tag).toBe('replayed');
    expect(money.calls).toBe(1);
  });

  it('refuses an order nobody paid for', async () => {
    const { ledger } = ledgerOver();

    const refused = await run(
      Effect.flip(
        refundPayment({ orderId: 'order-unpaid', commandId: undefined }),
      ),
      ledger,
      provider(),
    );

    expect(refused).toMatchObject({ code: 'noCapturedPayment' });
  });

  it('records a declined refund, and answers it declined', async () => {
    const { ledger } = await paid();

    const result = await run(
      refundPayment({ orderId: 'order-1', commandId: undefined }),
      ledger,
      provider(true),
    );

    expect(result).toMatchObject({ _tag: 'declined', reason: 'too late' });
  });

  it('answers a refund that lost a race to a sibling command as replayed', async () => {
    const state = ledgerOver({ race: true });
    await run(
      capturePayment({ payment: aPayment(), commandId: undefined }),
      state.ledger,
      provider(),
    );

    const result = await run(
      refundPayment({ orderId: 'order-1', commandId: 'r-4' }),
      state.ledger,
      provider(),
    );

    expect(result._tag).toBe('replayed');
  });

  it('lets a store failure through as the error it is', async () => {
    const { ledger } = ledgerOver();
    const failing: PaymentLedger = {
      ...ledger,
      captureFor: () => Effect.fail(new EntifixConnError('store down')),
    };

    const error = await run(
      Effect.flip(refundPayment({ orderId: 'order-1', commandId: undefined })),
      failing,
      provider(),
    );

    expect(error).toBeInstanceOf(EntifixConnError);
  });
});
