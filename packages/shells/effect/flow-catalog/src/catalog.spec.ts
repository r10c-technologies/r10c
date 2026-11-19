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
import { Effect, Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  cancellationRecipe,
  type CancellationStart,
  checkoutRecipe,
  CheckoutStart,
  deliveryCorrelation,
  deliveryRecipe,
  type DeliveryStart,
  FLOW_RECIPES,
  flowCatalog,
  paymentCorrelation,
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
  name: `Name of ${offeringId}`,
  quantity: 2,
  amount: 500,
  currency: 'GTQ',
});

const part = (
  vendorId: string,
  paymentMethod: 'card' | 'cash' | 'cod' | 'link',
  entitlements: readonly string[] = PROVISIONED,
) => ({
  vendorId,
  paymentMethod,
  lines: [line(`${vendorId}-o-1`)],
  entitlements,
});

/** A storefront buyer's contact; a counter sale names none (ADR 0076 §3). */
const CONTACT = {
  name: 'Ana López',
  phone: '+50255551234',
  email: 'ana@correo.com',
  destination: {
    departamento: '01',
    municipio: '0108',
    zona: 4,
    addressLine: '5a avenida 12-34',
  },
};

/** The payment window and its grace the coordinator states, in ms. */
const WINDOW = 172_800_000;
const GRACE = 3_600_000;

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
  paymentWindowMs: WINDOW,
  paymentGraceMs: GRACE,
  ...(channel === 'storefront' ? { contact: CONTACT, locale: 'es' } : {}),
});

/** The seven checkouts the marketplace sells through (#486, ADR 0081). */
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
  {
    label: 'storefront, payment link only',
    value: checkout('storefront', [part('v-1', 'link')]),
  },
  {
    label: 'storefront, card and payment link',
    value: checkout('storefront', [part('v-1', 'card'), part('v-2', 'link')]),
  },
  {
    label: 'counter, payment link',
    value: checkout('counter', [part('v-1', 'link')]),
  },
];

const composed = (start: CheckoutStart) =>
  Effect.runSync(
    compose(checkoutRecipe, flowCatalog, coordinator, start, OPTIONS),
  );

const refsOf = (slip: Slip) => slipSteps(slip).map(step => step.step);

describe('the checkout recipe', () => {
  it('composes all eight checkouts for the coordinator, from the vendors’ entitlements', () => {
    const outcomes = enumerateCompositions(checkoutRecipe, flowCatalog, {
      contexts: [{ label: 'the coordinator', value: coordinator }],
      inputs: CHECKOUTS,
    });

    expect(() => expectAllCompositionsValid(outcomes)).not.toThrow();
    expect(outcomes.map(outcome => outcome.outcome)).toEqual(
      Array(CHECKOUTS.length).fill('composed'),
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
      'order.notify-buyer',
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

  it('commits a link segment, then waits on its seller and branches on the answer', () => {
    const slip = composed(CHECKOUTS[6]!.value);

    expect(refsOf(slip)).toEqual([
      'order.open-group',
      'v-1/card:v-1-o-1:stock.reserve',
      'v-1/card:order.write',
      'v-2/link:v-2-o-1:stock.reserve',
      'v-2/link:order.write',
      'payment.capture',
      'v-1/card:v-1-o-1:stock.convert',
      'v-1/card:order.confirm',
      'v-1/card:fulfilment.open',
      'v-2/link:order.await-payment',
      'order.notify-buyer',
      'v-2/link:order.payment-decision',
      'v-2/link:v-2-o-1:stock.convert',
      'v-2/link:order.confirm',
      'v-2/link:fulfilment.open',
      'v-2/link:v-2-o-1:stock.release',
    ]);
    const step = (name: string) =>
      slipSteps(slip).find(candidate => candidate.step === name);
    // The capture takes the card seller's share alone.
    expect(step('payment.capture')?.parameters).toMatchObject({
      shares: [{ vendorId: 'v-1', amount: 1000 }],
    });
    // The hold outlives the decision: window + 2 × grace.
    expect(step('v-2/link:v-2-o-1:stock.reserve')?.parameters).toMatchObject({
      holdSeconds: (WINDOW + 2 * GRACE) / 1000,
    });
    expect(
      step('v-1/card:v-1-o-1:stock.reserve')?.parameters,
    ).not.toHaveProperty('holdSeconds');
    expect(step('v-2/link:order.await-payment')?.parameters).toMatchObject({
      paymentWindowMs: WINDOW,
    });
    expect(step('v-2/link:order.payment-decision')?.parameters).toMatchObject({
      correlation: paymentCorrelation('f', 'v-2'),
      timeoutMs: WINDOW + GRACE,
      onTimeout: 'strand',
    });
    expect(step('v-2/link:order.confirm')?.guard).toEqual({
      wait: 'v-2/link:order.payment-decision',
      outcomes: ['confirmed'],
    });
    expect(step('v-2/link:v-2-o-1:stock.release')?.guard).toEqual({
      wait: 'v-2/link:order.payment-decision',
      outcomes: ['cancelled'],
    });
  });

  it('passes flow.commit for a basket paid by link alone', () => {
    const refs = refsOf(composed(CHECKOUTS[5]!.value));

    expect(refs).toContain('flow.commit');
    expect(refs).not.toContain('payment.capture');
  });

  it('hands a counter link sale over once it is paid', () => {
    const refs = refsOf(composed(CHECKOUTS[7]!.value));

    expect(refs.slice(-4)).toEqual([
      'v-1/link:order.confirm',
      'v-1/link:order.mark-dispatched',
      'v-1/link:order.close',
      'v-1/link:v-1-o-1:stock.release',
    ]);
  });

  it('refuses a link checkout that states no payment window', () => {
    const decode = Schema.decodeUnknownExit(CheckoutStart);
    const { paymentWindowMs: _window, ...unstated } = CHECKOUTS[5]!.value;
    const { paymentWindowMs: _w, paymentGraceMs: _g, ...card } =
      CHECKOUTS[0]!.value;

    expect(decode(unstated)._tag).toBe('Failure');
    expect(decode(card)._tag).toBe('Success');
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
    expect(refsOf(slip)).not.toContain('order.notify-buyer');
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
      contact: CONTACT,
      locale: 'es',
      buyerId: 'party-1',
    });
    expect(
      slipSteps(slip).find(step => step.step === 'v-1/card:order.write')
        ?.parameters,
    ).toMatchObject({ buyerId: 'party-1' });
  });

  it('requires a storefront buyer’s contact, and none at a counter', () => {
    const { contact: _dropped, ...noContact } = CHECKOUTS[0]!.value;
    const decode = Schema.decodeUnknownExit(CheckoutStart);

    expect(decode(noContact)._tag).toBe('Failure');
    expect(decode(checkout('counter', [part('v-1', 'card')]))._tag).toBe(
      'Success',
    );
  });

  it('opens the shipment with who receives it, where, and the order’s number, never the email', () => {
    const slip = composed(CHECKOUTS[0]!.value);
    const open = slipSteps(slip).find(
      step => step.step === 'v-1/card:fulfilment.open',
    );

    expect(open?.parameters).toMatchObject({
      destination: {
        name: CONTACT.name,
        phone: CONTACT.phone,
        destination: CONTACT.destination,
      },
    });
    expect(JSON.stringify(open?.parameters)).not.toContain(CONTACT.email);
  });

  it('writes each line under the name it was sold as, into the order and the shipment (#582)', () => {
    const start = CHECKOUTS[0]!.value;
    const slip = composed(start);
    const step = (ref: string) =>
      slipSteps(slip).find(entry => entry.step === `v-1/card:${ref}`)
        ?.parameters as { items?: unknown[]; lines?: unknown[] } | undefined;

    const sold = { offeringId: 'v-1-o-1', name: 'Name of v-1-o-1' };
    expect(step('order.write')?.items).toEqual([expect.objectContaining(sold)]);
    expect(step('fulfilment.open')?.lines).toEqual([{ ...sold, quantity: 2 }]);
    // The slip is composed from the start alone: nothing reads the projection
    // again, so a rename after the checkout reaches neither write.
  });

  it('refuses a line that names nothing it was sold as', () => {
    const decode = Schema.decodeUnknownExit(CheckoutStart);
    const unnamed: Partial<ReturnType<typeof line>> = line('v-1-o-1');
    delete unnamed.name;
    const start = checkout('counter', [part('v-1', 'card')]);

    // Decoded as the coordinator receives it: an unknown body.
    expect(
      decode({ ...start, vendors: [{ ...start.vendors[0], lines: [unnamed] }] })
        ._tag,
    ).toBe('Failure');
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
      orderId: 'ord-1',
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

const delivery = (
  paymentMethod: DeliveryStart['paymentMethod'],
): DeliveryStart => ({
  shippingOrderId: 'ord-1',
  orderId: 'ord-1',
  groupId: 'grp-1',
  vendorId: 'v-1',
  paymentMethod,
  amountDue: paymentMethod === 'cod' ? 1000 : 0,
  taxableBase: 893,
  taxAmount: 107,
  taxRegime: 'general',
  currency: 'GTQ',
  lines: [{ offeringId: 'o-1', quantity: 2 }],
  entitlements: PROVISIONED,
  awaitDeliveryMs: 1_209_600_000,
  awaitReturnMs: 2_592_000_000,
});

const deliverySlip = (start: DeliveryStart) =>
  Effect.runSync(
    compose(deliveryRecipe, flowCatalog, coordinator, start, OPTIONS),
  );

describe('the delivery recipe', () => {
  it('composes a card and a cash-on-delivery delivery', () => {
    const outcomes = enumerateCompositions(deliveryRecipe, flowCatalog, {
      contexts: [{ label: 'the coordinator', value: coordinator }],
      inputs: [
        { label: 'card', value: delivery('card') },
        { label: 'cod', value: delivery('cod') },
      ],
    });

    expect(outcomes.map(outcome => outcome.outcome)).toEqual([
      'composed',
      'composed',
    ]);
  });

  it('dispatches, waits, and branches on the report into a delivered and a returned tail', () => {
    const slip = deliverySlip(delivery('cod'));

    expect(
      slipSteps(slip).map(step => [step.step, step.guard?.outcomes]),
    ).toEqual([
      ['v-1/cod:fulfilment.dispatch', undefined],
      ['v-1/cod:order.mark-dispatched', undefined],
      ['v-1/cod:fulfilment.await-delivery', undefined],
      ['v-1/cod:payment.record-collection', ['delivered']],
      ['v-1/cod:order.close-fulfilled', ['delivered']],
      ['v-1/cod:fulfilment.await-return', ['refused', 'unanswered']],
      ['v-1/cod:o-1:stock.restore', ['refused', 'unanswered']],
      ['v-1/cod:order.close-cancelled', ['refused', 'unanswered']],
    ]);
    for (const step of slipSteps(slip).filter(each => each.guard))
      expect(step.guard?.wait).toBe('v-1/cod:fulfilment.await-delivery');
  });

  it('waits on the shipment, and answers an unanswered delivery as a refusal and a lost return by stranding', () => {
    const steps = slipSteps(deliverySlip(delivery('card')));
    const awaitDelivery = steps.find(step =>
      step.step.endsWith('await-delivery'),
    );
    const awaitReturn = steps.find(step => step.step.endsWith('await-return'));

    expect(awaitDelivery?.parameters).toMatchObject({
      correlation: deliveryCorrelation('ord-1'),
      timeoutMs: 1_209_600_000,
      onTimeout: { outcome: 'unanswered' },
    });
    expect(awaitReturn?.parameters).toMatchObject({
      correlation: deliveryCorrelation('ord-1'),
      timeoutMs: 2_592_000_000,
      onTimeout: 'strand',
    });
  });

  it('collects no cash for a card order, and refunds it once the parcel is back', () => {
    const steps = slipSteps(deliverySlip(delivery('card')));

    expect(steps.map(step => step.step)).not.toContain(
      'v-1/card:payment.record-collection',
    );
    expect(steps.at(-1)).toMatchObject({
      step: 'v-1/card:payment.refund-after-delivery',
      parameters: { orderId: 'ord-1' },
    });
    expect(
      steps.find(step => step.step.endsWith('stock.restore'))?.parameters,
    ).toMatchObject({
      cause: 'return',
      organizationId: 'v-1',
      orderId: 'ord-1',
    });
  });

  it('records the cash a courier collected, for the order’s own group and vendor', () => {
    const collection = slipSteps(deliverySlip(delivery('cod'))).find(step =>
      step.step.endsWith('record-collection'),
    );

    expect(collection?.parameters).toEqual({
      groupId: 'grp-1',
      orderId: 'ord-1',
      vendorId: 'v-1',
      amount: 1000,
      taxableBase: 893,
      taxAmount: 107,
      taxRegime: 'general',
      currency: 'GTQ',
    });
  });

  it('reaches the vendor, and the buyer when one is named', () => {
    expect(
      deliverySlip({ ...delivery('card'), buyerId: 'p-1' }).audience,
    ).toEqual([
      { kind: 'organization', id: 'v-1' },
      { kind: 'party', id: 'p-1' },
    ]);
  });

  it('refuses a wait planted before the dispatch', () => {
    const slip = deliverySlip(delivery('cod'));
    const [dispatch, wait, ...rest] = slip.stages;
    const planted: Slip = { ...slip, stages: [wait!, dispatch!, ...rest] };

    expect(
      validateSlip(planted, flowCatalog).map(violation => violation.tag),
    ).toContain('WaitBeforeCommit');
  });

  it('refuses a step guarded on an outcome no wait is answered with', () => {
    const slip = deliverySlip(delivery('cod'));
    const planted: Slip = {
      ...slip,
      stages: slip.stages.map(stage => ({
        ...stage,
        steps: stage.steps.map(step =>
          step.guard === undefined
            ? step
            : { ...step, guard: { ...step.guard, outcomes: ['lost'] } },
        ),
      })),
    };

    expect(
      validateSlip(planted, flowCatalog).map(violation => violation.tag),
    ).toContain('UnknownGuard');
  });

  it('holds a delivery whose entitlements nobody stated to none', () => {
    const { entitlements: _none, ...unstated } = delivery('card');
    const outcomes = enumerateCompositions(deliveryRecipe, flowCatalog, {
      contexts: [{ label: 'the coordinator', value: coordinator }],
      inputs: [{ label: 'unstated', value: unstated }],
    });

    expect(outcomes.map(outcome => outcome.outcome)).toEqual(['unmet']);
  });
});

describe('the flow catalog', () => {
  it('names every recipe it holds', () => {
    expect(Object.keys(FLOW_RECIPES)).toEqual([
      'checkout',
      'cancellation',
      'delivery',
    ]);
  });

  // A contract change without a version bump changes a fingerprint here, and
  // the register reads this same file to check every call it names.
  it('matches its committed snapshot', async () => {
    await expect(
      `${JSON.stringify(catalogDocument(flowCatalog), null, 2)}\n`,
    ).toMatchFileSnapshot('../catalog-snapshot.json');
  });
});
