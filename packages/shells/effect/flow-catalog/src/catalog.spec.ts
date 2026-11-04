import {
  compose,
  enumerateCompositions,
  expectAllCompositionsValid,
} from '@entifix/business/compose';
import {
  catalogDocument,
  type Slip,
  slipSteps,
  validateSlip,
} from '@entifix/business/flow';
import { verifiedContext } from '@entifix/business/verified';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  cancellationRecipe,
  type CancellationStart,
  checkoutRecipe,
  type CheckoutStart,
  FLOW_RECIPES,
  flowCatalog,
} from './catalog.js';

/** A vendor provisioned for everything a checkout's steps require. */
const PROVISIONED = ['stock-management', 'shipping-order-management'];

/**
 * The coordinator's own context: a crossing caller holds no entitlement, which
 * is exactly a storefront buyer's case — what a step requires comes from the
 * vendors' segments, never from whoever asked.
 */
const coordinator = verifiedContext({
  entitlements: [],
  roles: [],
  flags: [],
  config: {},
});

const OPTIONS = { flowId: 'f', composedAt: '2026-10-28T00:00:00.000Z' };

const line = (offeringId: string) => ({
  offeringId,
  quantity: 2,
  amount: 500,
  currency: 'GTQ',
});

const part = (
  vendorId: string,
  paymentMethod: 'card' | 'cash' | 'cod',
  entitlements: readonly string[] = PROVISIONED,
) => ({
  vendorId,
  paymentMethod,
  lines: [line(`${vendorId}-o-1`)],
  entitlements,
});

const checkout = (
  channel: 'storefront' | 'counter',
  vendors: CheckoutStart['vendors'],
): CheckoutStart => ({
  groupId: 'f',
  channel:
    channel === 'counter'
      ? { type: 'counter', id: 'ch-1', name: 'Front desk' }
      : { type: 'storefront' },
  vendors,
  totals: [{ currency: 'GTQ', amount: 1000 * vendors.length }],
  capabilityDigest: 'cap',
  cancelDigest: 'cancel',
});

/** The five checkouts the marketplace sells through (#486). */
const CHECKOUTS = [
  {
    label: 'storefront, card only',
    value: checkout('storefront', [part('v-1', 'card'), part('v-2', 'card')]),
  },
  {
    label: 'storefront, cash on delivery only',
    value: checkout('storefront', [part('v-1', 'cod'), part('v-2', 'cod')]),
  },
  {
    label: 'storefront, mixed',
    value: checkout('storefront', [part('v-1', 'card'), part('v-2', 'cod')]),
  },
  {
    label: 'counter, cash',
    value: checkout('counter', [part('v-1', 'cash')]),
  },
  {
    label: 'counter, card',
    value: checkout('counter', [part('v-1', 'card')]),
  },
];

const composed = (start: CheckoutStart) =>
  Effect.runSync(
    compose(checkoutRecipe, flowCatalog, coordinator, start, OPTIONS),
  );

const refsOf = (slip: Slip) => slipSteps(slip).map(step => step.step);

describe('the checkout recipe', () => {
  it('composes all five checkouts for the coordinator, from the vendors’ entitlements', () => {
    const outcomes = enumerateCompositions(checkoutRecipe, flowCatalog, {
      contexts: [{ label: 'the coordinator', value: coordinator }],
      inputs: CHECKOUTS,
    });

    expect(() => expectAllCompositionsValid(outcomes)).not.toThrow();
    expect(outcomes.map(outcome => outcome.outcome)).toEqual(
      Array(5).fill('composed'),
    );
  });

  it('refuses, as unmet, a vendor not provisioned for stock', () => {
    const outcomes = enumerateCompositions(checkoutRecipe, flowCatalog, {
      contexts: [{ label: 'the coordinator', value: coordinator }],
      inputs: [
        {
          label: 'an unprovisioned vendor',
          value: checkout('storefront', [part('v-1', 'card', [])]),
        },
      ],
    });

    expect(outcomes.map(outcome => outcome.outcome)).toEqual(['unmet']);
  });

  it('runs a mixed basket around one capture of the card vendor’s share', () => {
    const slip = composed(CHECKOUTS[2]!.value);

    expect(refsOf(slip)).toEqual([
      'order.open-group',
      'v-1/card:v-1-o-1:stock.reserve',
      'v-1/card:order.write',
      'v-2/cod:payment.cod-eligible',
      'v-2/cod:v-2-o-1:stock.reserve',
      'v-2/cod:order.write',
      'payment.capture',
      'v-1/card:v-1-o-1:stock.convert',
      'v-1/card:order.confirm',
      'v-1/card:fulfilment.open',
      'v-2/cod:v-2-o-1:stock.convert',
      'v-2/cod:order.confirm',
      'v-2/cod:fulfilment.open',
    ]);
    const capture = slipSteps(slip).find(
      step => step.step === 'payment.capture',
    );
    expect(capture?.parameters).toEqual({
      currency: 'GTQ',
      paymentMethod: 'card',
      shares: [{ vendorId: 'v-1', amount: 1000 }],
    });
    const shipment = slipSteps(slip).find(
      step => step.step === 'v-2/cod:fulfilment.open',
    );
    expect(shipment?.parameters).toMatchObject({
      organizationId: 'v-2',
      paymentMethod: 'cod',
      amountDue: 1000,
    });
    expect(slip.audience).toEqual([
      { kind: 'flow', id: 'f', digest: 'cap' },
      { kind: 'organization', id: 'v-1' },
      { kind: 'organization', id: 'v-2' },
    ]);
  });

  it('passes flow.commit for a basket all on delivery, and takes no money', () => {
    const refs = refsOf(composed(CHECKOUTS[1]!.value));

    expect(refs).toContain('flow.commit');
    expect(refs).not.toContain('payment.capture');
  });

  it('hands a counter sale over rather than shipping it', () => {
    const slip = composed(CHECKOUTS[3]!.value);

    expect(refsOf(slip).slice(-5)).toEqual([
      'payment.capture',
      'v-1/cash:v-1-o-1:stock.convert',
      'v-1/cash:order.confirm',
      'v-1/cash:order.mark-dispatched',
      'v-1/cash:order.close',
    ]);
    expect(
      slipSteps(slip).find(step => step.step === 'v-1/cash:order.write')
        ?.parameters,
    ).toMatchObject({
      channel: { type: 'counter', id: 'ch-1', name: 'Front desk' },
    });
  });

  it('opens no shipment for a vendor not provisioned to ship', () => {
    const refs = refsOf(
      composed(
        checkout('storefront', [part('v-1', 'card', ['stock-management'])]),
      ),
    );

    expect(refs.some(ref => ref.endsWith('fulfilment.open'))).toBe(false);
  });

  it('reaches a signed-in buyer, and opens a group with no cancel digest when none was sent', () => {
    const { cancelDigest: _dropped, ...noDigest } = CHECKOUTS[0]!.value;
    const slip = composed({ ...noDigest, buyerId: 'party-1' });

    expect(slip.audience).toContainEqual({ kind: 'party', id: 'party-1' });
    expect(slipSteps(slip)[0]?.parameters).toEqual({
      id: 'f',
      totals: [{ currency: 'GTQ', amount: 2000 }],
      buyerId: 'party-1',
    });
    expect(
      slipSteps(slip).find(step => step.step === 'v-1/card:order.write')
        ?.parameters,
    ).toMatchObject({ buyerId: 'party-1' });
  });

  it('holds a vendor whose entitlements nobody stated to none', () => {
    const { entitlements: _none, ...unstated } = part('v-1', 'card');
    const outcomes = enumerateCompositions(checkoutRecipe, flowCatalog, {
      contexts: [{ label: 'the coordinator', value: coordinator }],
      inputs: [
        { label: 'unstated', value: checkout('storefront', [unstated]) },
      ],
    });

    expect(outcomes.map(outcome => outcome.outcome)).toEqual(['unmet']);
  });

  // The rule that keeps a conversion compensable: planted, it must fail.
  it('refuses a conversion planted before the commit point', () => {
    const slip = composed(CHECKOUTS[0]!.value);
    const [group, place, pay, ...rest] = slip.stages;
    const conversion = rest[0]!.steps[0]!;
    const planted: Slip = {
      ...slip,
      stages: [
        group!,
        { ...place!, steps: [...place!.steps, conversion] },
        pay!,
        ...rest,
      ],
    };

    expect(
      validateSlip(planted, flowCatalog, { context: coordinator }).map(
        violation => violation.tag,
      ),
    ).toContain('RetriableBeforeCommit');
  });
});

const cancellation = (
  paymentMethod: CancellationStart['paymentMethod'],
  shipped: boolean,
): CancellationStart => ({
  orderId: 'ord-1',
  vendorId: 'v-1',
  paymentMethod,
  lines: [{ offeringId: 'o-1', quantity: 2 }],
  shipped,
  entitlements: PROVISIONED,
});

describe('the cancellation recipe', () => {
  it('composes a card, a cash and a cash-on-delivery cancellation', () => {
    const outcomes = enumerateCompositions(cancellationRecipe, flowCatalog, {
      contexts: [{ label: 'the coordinator', value: coordinator }],
      inputs: [
        { label: 'card, shipped', value: cancellation('card', true) },
        { label: 'cash, at a counter', value: cancellation('cash', false) },
        { label: 'cod, shipped', value: cancellation('cod', true) },
      ],
    });

    expect(outcomes.map(outcome => outcome.outcome)).toEqual(
      Array(3).fill('composed'),
    );
  });

  it('holds a cancellation whose entitlements nobody stated to none', () => {
    const { entitlements: _none, ...unstated } = cancellation('card', false);
    const outcomes = enumerateCompositions(cancellationRecipe, flowCatalog, {
      contexts: [{ label: 'the coordinator', value: coordinator }],
      inputs: [{ label: 'unstated', value: unstated }],
    });

    expect(outcomes.map(outcome => outcome.outcome)).toEqual(['unmet']);
  });

  it('holds the shipment, claims, refunds, then puts back, withdraws and closes', () => {
    const slip = Effect.runSync(
      compose(
        cancellationRecipe,
        flowCatalog,
        coordinator,
        cancellation('card', true),
        OPTIONS,
      ),
    );

    expect(refsOf(slip)).toEqual([
      'v-1/card:fulfilment.hold',
      'v-1/card:order.claim-cancel',
      'v-1/card:payment.refund',
      'v-1/card:o-1:stock.restore',
      'v-1/card:fulfilment.withdraw',
      'v-1/card:order.close',
    ]);
    expect(slipSteps(slip)[0]?.parameters).toEqual({
      orderId: 'ord-1',
      shippingOrderId: 'ord-1',
      organizationId: 'v-1',
    });
    expect(slipSteps(slip)[3]?.parameters).toEqual({
      offeringId: 'o-1',
      quantity: 2,
      organizationId: 'v-1',
      cause: 'cancellation',
    });
  });

  it('refunds nothing for cash on delivery, and holds no shipment never opened', () => {
    const refs = refsOf(
      Effect.runSync(
        compose(
          cancellationRecipe,
          flowCatalog,
          coordinator,
          cancellation('cod', false),
          OPTIONS,
        ),
      ),
    );

    expect(refs).toEqual([
      'v-1/cod:order.claim-cancel',
      'v-1/cod:flow.commit',
      'v-1/cod:o-1:stock.restore',
      'v-1/cod:order.close',
    ]);
  });
});

describe('the flow catalog', () => {
  it('names every recipe it holds', () => {
    expect(Object.keys(FLOW_RECIPES)).toEqual(['checkout', 'cancellation']);
  });

  // A contract change without a version bump changes a fingerprint here, and
  // the register reads this same file to check every call it names.
  it('matches its committed snapshot', async () => {
    await expect(
      `${JSON.stringify(catalogDocument(flowCatalog), null, 2)}\n`,
    ).toMatchFileSnapshot('../catalog-snapshot.json');
  });
});
