import { Effect, Layer, Option } from 'effect';
import { describe, expect, it } from 'vitest';

import { Payment } from '../entities/payment/index.js';
import { PaymentAllocation } from '../entities/payment-allocation/index.js';
import { Refund } from '../entities/refund/index.js';
import { CodAcceptanceTag, CodPolicyTag } from '../ports/cod.js';
import {
  type PaymentLedger,
  PaymentLedgerTag,
} from '../ports/payment-ledger.js';
import { PaymentProviderTag } from '../ports/payment-provider.js';
import { makeInMemoryPaymentLedger } from '../testing/in-memory-payment-ledger.js';
import {
  type DeclineRule,
  makeScriptedPaymentProvider,
} from '../testing/scripted-payment-provider.js';
import {
  capturePayment,
  checkCodEligibility,
  recordCollection,
  refundPayment,
  sharesProblem,
} from './take-payment.js';

const SHARES = [
  { orderId: 'order-1', vendorId: 'vendor-1', amount: 30 },
  { orderId: 'order-2', vendorId: 'vendor-2', amount: 10 },
];

const aPayment = () => new Payment('group-1', 40, 'GTQ');

/** Run against a ledger (the in-memory double unless given) and a provider. */
const run = <A, E>(
  effect: Effect.Effect<
    A,
    E,
    PaymentLedgerTag | PaymentProviderTag | CodPolicyTag | CodAcceptanceTag
  >,
  options: {
    readonly ledger?: PaymentLedger;
    readonly declines?: DeclineRule;
    readonly cod?: { enabled: boolean; maxAmount: number };
    readonly accepts?: boolean;
  } = {},
) =>
  Effect.runPromise(
    Effect.provide(
      effect,
      Layer.mergeAll(
        Layer.succeed(
          PaymentLedgerTag,
          options.ledger ?? makeInMemoryPaymentLedger(),
        ),
        Layer.succeed(
          PaymentProviderTag,
          makeScriptedPaymentProvider(options.declines),
        ),
        Layer.succeed(
          CodPolicyTag,
          options.cod ?? { enabled: true, maxAmount: 150_000 },
        ),
        Layer.succeed(CodAcceptanceTag, {
          acceptsCod: () => Effect.succeed(options.accepts ?? true),
        }),
      ),
    ),
  );

const refusalOf = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.map(Effect.flip(effect), failure => failure as { code: string });

describe('sharesProblem', () => {
  it.each([
    [0, SHARES, 'a payment must carry a positive amount'],
    [40, [], 'a payment must pay for at least one order'],
    [
      40,
      [{ orderId: 'o', vendorId: 'v', amount: 0 }],
      'every order share must be positive',
    ],
    [
      40,
      [SHARES[0], { ...SHARES[0], amount: 10 }],
      'an order may be paid for once per payment',
    ],
    [41, SHARES, 'the order shares must sum to the amount charged'],
  ] as const)('refuses %s split as %j', (amount, shares, problem) => {
    expect(sharesProblem(amount, shares as never)).toBe(problem);
  });

  it('accepts shares that split the amount exactly', () => {
    expect(sharesProblem(40, SHARES)).toBeUndefined();
  });
});

describe('capturePayment', () => {
  it('captures once for the group and allocates a share to each order', async () => {
    const ledger = makeInMemoryPaymentLedger();

    const result = await run(
      capturePayment({ payment: aPayment(), shares: SHARES, commandId: 'c-1' }),
      { ledger },
    );

    expect(result).toMatchObject({
      _tag: 'captured',
      payment: { groupId: 'group-1', status: 'captured' },
    });
    expect(
      await Effect.runPromise(ledger.allocationFor('order-2')),
    ).toMatchObject({ vendorId: 'vendor-2', captured: 10, refunded: 0 });
  });

  it('refuses shares that do not split the amount, before the provider', async () => {
    const refused = await run(
      refusalOf(
        capturePayment({
          payment: aPayment(),
          shares: [],
          commandId: undefined,
        }),
      ),
    );

    expect(refused.code).toBe('invalidBody');
  });

  it('answers a redelivered command with the first capture', async () => {
    const ledger = makeInMemoryPaymentLedger();
    const first = await run(
      capturePayment({ payment: aPayment(), shares: SHARES, commandId: 'c-1' }),
      { ledger },
    );

    const again = await run(
      capturePayment({ payment: aPayment(), shares: SHARES, commandId: 'c-1' }),
      { ledger },
    );

    expect(again).toEqual({ _tag: 'replayed', payment: first.payment });
  });

  it('records a declined capture, answers the reason, and repeats the refusal', async () => {
    const ledger = makeInMemoryPaymentLedger();
    const declines = () => true;

    const refused = await run(
      refusalOf(
        capturePayment({
          payment: aPayment(),
          shares: SHARES,
          commandId: 'c-1',
        }),
      ),
      { ledger, declines },
    );
    const again = await run(
      refusalOf(
        capturePayment({
          payment: aPayment(),
          shares: SHARES,
          commandId: 'c-1',
        }),
      ),
      { ledger },
    );

    expect(refused).toMatchObject({
      code: 'paymentDeclined',
      reason: 'declined',
    });
    expect((refused as unknown as Error).message).toBe('declined');
    expect((again as unknown as Error).message).toBe(
      'the payment was not captured',
    );
    expect(again).toMatchObject({ code: 'paymentDeclined' });
    expect((again as { reason?: string }).reason).toBeUndefined();
  });

  it('answers a capture that lost a race to its own command with the winner', async () => {
    const inner = makeInMemoryPaymentLedger();
    const winner = Object.assign(aPayment(), {
      id: 'pay-0',
      status: 'captured',
    });
    const declined = Object.assign(aPayment(), {
      id: 'pay-0',
      status: 'failed',
    });

    const won = await run(
      capturePayment({ payment: aPayment(), shares: SHARES, commandId: 'c-1' }),
      {
        ledger: {
          ...inner,
          recordCapture: () =>
            Effect.succeed({ _tag: 'replayed', record: winner }),
        },
      },
    );
    const lost = await run(
      refusalOf(
        capturePayment({
          payment: aPayment(),
          shares: SHARES,
          commandId: 'c-1',
        }),
      ),
      {
        ledger: {
          ...inner,
          recordCapture: () =>
            Effect.succeed({ _tag: 'replayed', record: declined }),
        },
      },
    );

    expect(won).toEqual({ _tag: 'replayed', payment: winner });
    expect(lost.code).toBe('paymentDeclined');
  });
});

describe('recordCollection', () => {
  const collect = (commandId: string | undefined, amount = 25) =>
    recordCollection({
      groupId: 'group-1',
      share: { orderId: 'order-3', vendorId: 'vendor-3', amount },
      currency: 'GTQ',
      commandId,
    });

  it('records the courier’s cash as a captured cod payment for the one order', async () => {
    const ledger = makeInMemoryPaymentLedger();

    const result = await run(collect('k-1'), { ledger });

    expect(result).toMatchObject({
      _tag: 'captured',
      payment: { paymentMethod: 'cod', status: 'captured', amount: 25 },
    });
    expect(
      await Effect.runPromise(ledger.allocationFor('order-3')),
    ).toMatchObject({ captured: 25, paymentMethod: 'cod' });
  });

  it('answers a repeated report with the first collection', async () => {
    const ledger = makeInMemoryPaymentLedger();
    const first = await run(collect('k-1'), { ledger });

    expect(await run(collect('k-1'), { ledger })).toEqual({
      _tag: 'replayed',
      payment: first.payment,
    });
  });

  it('answers a collection that lost a race to its own command with the winner', async () => {
    const winner = Object.assign(aPayment(), { id: 'pay-0' });
    const result = await run(collect(undefined), {
      ledger: {
        ...makeInMemoryPaymentLedger(),
        recordCapture: () =>
          Effect.succeed({ _tag: 'replayed', record: winner }),
      },
    });

    expect(result).toEqual({ _tag: 'replayed', payment: winner });
  });

  it('refuses a collection of nothing', async () => {
    expect((await run(refusalOf(collect(undefined, 0)))).code).toBe(
      'invalidBody',
    );
  });
});

describe('refundPayment', () => {
  const captured = async (ledger = makeInMemoryPaymentLedger()) => {
    await run(
      capturePayment({
        payment: aPayment(),
        shares: SHARES,
        commandId: undefined,
      }),
      { ledger },
    );
    return ledger;
  };

  it('refunds what is left of the order’s share by default', async () => {
    const ledger = await captured();

    const result = await run(
      refundPayment({ orderId: 'order-1', commandId: 'r-1' }),
      { ledger },
    );

    expect(result).toMatchObject({
      _tag: 'refunded',
      refund: { orderId: 'order-1', amount: 30, status: 'refunded' },
    });
  });

  it('refunds in parts until the share is spent, and refuses the part past it', async () => {
    const ledger = await captured();

    await run(
      refundPayment({ orderId: 'order-1', amount: 20, commandId: 'r-1' }),
      {
        ledger,
      },
    );
    await run(
      refundPayment({ orderId: 'order-1', amount: 10, commandId: 'r-2' }),
      {
        ledger,
      },
    );
    const third = await run(
      refusalOf(
        refundPayment({ orderId: 'order-1', amount: 1, commandId: 'r-3' }),
      ),
      { ledger },
    );

    expect(third).toMatchObject({
      code: 'refundExceedsCapture',
      requested: 1,
      remaining: 0,
    });
  });

  it('refuses a refund of nothing or of more than was taken', async () => {
    const ledger = await captured();

    const none = await run(
      refusalOf(
        refundPayment({ orderId: 'order-2', amount: 0, commandId: undefined }),
      ),
      { ledger },
    );
    const more = await run(
      refusalOf(
        refundPayment({ orderId: 'order-2', amount: 11, commandId: undefined }),
      ),
      { ledger },
    );

    expect(none.code).toBe('refundExceedsCapture');
    expect(more).toMatchObject({ code: 'refundExceedsCapture', remaining: 10 });
  });

  it('refuses an order nothing was captured for', async () => {
    const empty = await run(
      refusalOf(refundPayment({ orderId: 'order-1', commandId: undefined })),
    );
    const zero = await run(
      refusalOf(refundPayment({ orderId: 'order-1', commandId: undefined })),
      {
        ledger: {
          ...makeInMemoryPaymentLedger(),
          allocationFor: () =>
            Effect.succeed(Object.assign(new PaymentAllocation(), { id: 'a' })),
        },
      },
    );

    expect(empty.code).toBe('noCapturedPayment');
    expect((empty as unknown as Error).message).toBe(
      'nothing was captured for order order-1, so nothing can go back',
    );
    expect(zero.code).toBe('noCapturedPayment');
  });

  it('answers a repeated command with its refund, and a declined one with the refusal', async () => {
    const ledger = await captured();
    await run(
      refundPayment({ orderId: 'order-1', amount: 5, commandId: 'r-1' }),
      {
        ledger,
      },
    );
    await run(
      refusalOf(
        refundPayment({ orderId: 'order-2', amount: 5, commandId: 'r-2' }),
      ),
      { ledger, declines: () => true },
    );

    const replayed = await run(
      refundPayment({ orderId: 'order-1', amount: 5, commandId: 'r-1' }),
      { ledger },
    );
    const declined = await run(
      refusalOf(
        refundPayment({ orderId: 'order-2', amount: 5, commandId: 'r-2' }),
      ),
      { ledger },
    );

    expect(replayed).toMatchObject({ _tag: 'replayed', refund: { amount: 5 } });
    expect(declined.code).toBe('refundDeclined');
    // The declined refund gave its share back.
    expect(
      await Effect.runPromise(ledger.allocationFor('order-2')),
    ).toMatchObject({ refunded: 0 });
  });

  it('gives a declined refund’s share back and answers the provider’s reason', async () => {
    const ledger = await captured();

    const refused = await run(
      refusalOf(refundPayment({ orderId: 'order-1', commandId: undefined })),
      { ledger, declines: () => true },
    );

    expect(refused).toMatchObject({
      code: 'refundDeclined',
      reason: 'declined',
    });
    expect(
      await Effect.runPromise(ledger.allocationFor('order-1')),
    ).toMatchObject({ refunded: 0 });
  });

  it('answers what a racing refund left, when the guarded take loses', async () => {
    const ledger = await captured();
    const pending = Object.assign(new Refund('order-1', 'a', 5, 'GTQ'), {
      status: 'pending' as const,
    });
    const done = Object.assign(new Refund('order-1', 'a', 5, 'GTQ'), {
      status: 'refunded' as const,
    });
    const on = (
      reservation: Awaited<ReturnType<typeof Effect.runPromise>>,
    ) => ({
      ...ledger,
      decidedRefund: () => Effect.succeed(Option.none()),
      reserveRefund: () => Effect.succeed(reservation as never),
    });

    const exceeds = await run(
      refusalOf(refundPayment({ orderId: 'order-1', commandId: 'r-1' })),
      { ledger: on({ _tag: 'exceeds', remaining: 3 }) },
    );
    const replayedDone = await run(
      refundPayment({ orderId: 'order-1', commandId: 'r-1' }),
      { ledger: on({ _tag: 'replayed', refund: done }) },
    );
    const replayedPending = await run(
      refusalOf(refundPayment({ orderId: 'order-1', commandId: 'r-1' })),
      { ledger: on({ _tag: 'replayed', refund: pending }) },
    );

    expect(exceeds).toMatchObject({
      code: 'refundExceedsCapture',
      remaining: 3,
    });
    expect(replayedDone).toEqual({ _tag: 'replayed', refund: done });
    expect(replayedPending.code).toBe('refundDeclined');
  });
});

describe('checkCodEligibility', () => {
  const check = (amount = 1_000) =>
    checkCodEligibility({ vendorId: 'vendor-1', amount });

  it('admits a seller who ships it, under the limit', async () => {
    expect(await run(check())).toEqual({
      vendorId: 'vendor-1',
      eligible: true,
    });
  });

  it('refuses everyone while cash on delivery is switched off', async () => {
    const refused = await run(refusalOf(check()), {
      cod: { enabled: false, maxAmount: 150_000 },
    });

    expect(refused.code).toBe('codNotEntitled');
  });

  it('refuses an order over the limit, naming the limit', async () => {
    const refused = await run(refusalOf(check(150_001)));

    expect(refused).toMatchObject({ code: 'codOverLimit', limit: 150_000 });
  });

  it('refuses a seller who does not ship cash on delivery', async () => {
    const refused = await run(refusalOf(check()), { accepts: false });

    expect(refused.code).toBe('codNotEntitled');
  });
});
