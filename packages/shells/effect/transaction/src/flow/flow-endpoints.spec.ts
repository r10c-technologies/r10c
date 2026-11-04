import { IdempotencyKeyTag } from '@entifix/business';
import type { Slip } from '@entifix/business/flow';
import { FlowEngineTag } from '@entifix/transactions';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { flowStartEndpoints } from './flow-endpoints.js';
import { VendorFactsTag } from './vendor-facts.js';

const [checkout, cancellation] = flowStartEndpoints;

const PROVISIONED = ['stock-management', 'shipping-order-management'];

/** An engine that registers each key once, as the durable one does. */
const engine = () => {
  const started: Slip[] = [];
  const byKey = new Map<string, string>();
  return {
    started,
    service: {
      start: (slip: Slip, key: string) =>
        Effect.sync(() => {
          const first = byKey.get(key);
          if (first !== undefined) return { flowId: first };
          byKey.set(key, slip.flowId);
          started.push(slip);
          return { flowId: slip.flowId };
        }),
    },
  };
};

const world = (facts: Record<string, readonly string[]> = {}) => {
  const flows = engine();
  const run = <A, E>(
    endpoint: (typeof flowStartEndpoints)[number],
    payload: unknown,
    key = 'start-1',
  ) =>
    Effect.runPromise(
      Effect.result(
        (
          endpoint.handler({ payload } as never) as Effect.Effect<A, E, never>
        ).pipe(
          Effect.provideService(IdempotencyKeyTag, key),
          Effect.provideService(VendorFactsTag, {
            entitlementsOf: vendorIds =>
              Effect.succeed(
                new Map(vendorIds.map(id => [id, facts[id] ?? []] as const)),
              ),
          }),
          Effect.provideService(FlowEngineTag, flows.service as never),
        ),
      ),
    );
  return { flows, run };
};

const basket = {
  channel: { type: 'storefront' },
  vendors: [
    {
      vendorId: 'v-1',
      paymentMethod: 'card',
      lines: [{ offeringId: 'o-1', quantity: 1, amount: 500, currency: 'GTQ' }],
      // What a caller says it holds is never what the coordinator believes.
      entitlements: ['everything'],
    },
  ],
  totals: [{ currency: 'GTQ', amount: 500 }],
  capabilityDigest: 'cap',
};

describe('the flow start routes', () => {
  it('start each recipe by crossing, answered 202 and claimed by the engine', () => {
    expect(
      flowStartEndpoints.map(({ descriptor }) => [
        descriptor.method,
        descriptor.path,
        descriptor.guard,
        descriptor.idempotent,
        descriptor.accepted,
      ]),
    ).toEqual(
      ['checkout', 'cancellation'].map(name => [
        'POST',
        `/api/flow/${name}`,
        {
          kind: 'crossing',
          permission: 'order-management:product-order:write',
          organization: false,
        },
        'unit',
        true,
      ]),
    );
  });

  it('starts a checkout from what it verified: the vendors’ entitlements, and the group under the flow’s id', async () => {
    const { flows, run } = world({ 'v-1': PROVISIONED });

    const answer = await run(checkout, basket);

    const [slip] = flows.started;
    expect(answer).toMatchObject({
      _tag: 'Success',
      success: expect.objectContaining({
        meta: expect.objectContaining({ type: 'flowAccepted' }),
        data: {
          flowId: slip?.flowId,
          links: [
            { rel: 'status', href: `/api/realtime/flow/${slip?.flowId}` },
            { rel: 'stream', href: '/api/realtime/stream' },
          ],
        },
      }),
    });
    expect(slip?.stages[0]?.steps[0]?.parameters).toMatchObject({
      id: slip?.flowId,
    });
    expect(slip?.stages[1]?.steps[0]?.segment).toEqual({
      vendor: 'v-1',
      paymentMethod: 'card',
      entitlements: PROVISIONED,
    });
  });

  it('answers a repeated key with the flow the first start began', async () => {
    const { flows, run } = world({ 'v-1': PROVISIONED });

    const first = await run(checkout, basket);
    const again = await run(checkout, basket);

    expect(flows.started).toHaveLength(1);
    expect(again).toEqual(first);
  });

  it('refuses a vendor the coordinator finds unprovisioned, whatever the caller claimed', async () => {
    const { flows, run } = world();

    expect(await run(checkout, basket)).toMatchObject({
      failure: { _tag: 'FlowRequirementsUnmet' },
    });
    expect(flows.started).toEqual([]);
  });

  it.each([
    ['no body', undefined],
    ['a list', []],
    ['a basket with no vendors', { ...basket, vendors: 'none' }],
    [
      'a basket whose vendors are not parts',
      { ...basket, vendors: ['v-1', { paymentMethod: 'card' }] },
    ],
  ])('refuses %s as an invalid start', async (_label, payload) => {
    const { run } = world();

    expect(await run(checkout, payload)).toMatchObject({
      failure: { _tag: 'Invalid' },
    });
  });

  it('refuses a cancellation that names no vendor', async () => {
    const { run } = world();

    expect(await run(cancellation, { orderId: 'ord-1' })).toMatchObject({
      failure: { _tag: 'Invalid' },
    });
  });

  it('starts a cancellation from the order it names and the vendor it verified', async () => {
    const { flows, run } = world({ 'v-1': PROVISIONED });

    const answer = await run(cancellation, {
      orderId: 'ord-1',
      vendorId: 'v-1',
      paymentMethod: 'cod',
      lines: [{ offeringId: 'o-1', quantity: 1 }],
      shipped: true,
    });

    expect(answer).toMatchObject({ _tag: 'Success' });
    expect(flows.started[0]?.recipe).toBe('cancellation');
    expect(flows.started[0]?.stages[0]?.steps[0]?.segment).toMatchObject({
      entitlements: PROVISIONED,
    });
  });
});
