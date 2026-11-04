import type { Permission } from '@entifix/authz';
import { Unresolvable } from '@entifix/business';
import { IdempotencyKeyTag } from '@entifix/business';
import { compose, type Recipe } from '@entifix/business/compose';
import {
  CompositionRefused,
  FlowRequirementsUnmet,
} from '@entifix/business/flow';
import { verifiedContext } from '@entifix/business/verified';
import {
  defineEndpoint,
  DuplicateKey,
  implement,
  Invalid,
  JsonBody,
  makeEnvelope,
  Overloaded,
  UpstreamUnavailable,
} from '@entifix/core';
import { FlowEngineTag } from '@entifix/transactions';
import {
  cancellationRecipe,
  checkoutRecipe,
  deliveryRecipe,
  flowCatalog,
} from '@r10c/shells-effect-flow-catalog';
import { Effect } from 'effect';

import { type DeliveryDials, DeliveryDialsTag } from './delivery-dials.js';
import { VendorFactsTag } from './vendor-facts.js';

type Body = Readonly<Record<string, unknown>>;

/** The entitlement a vendor holds to ship what it sells. */
const SHIPPING_ENTITLEMENT = 'shipping-order-management';

const recordOf = (value: unknown): Body | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Body)
    : undefined;

const isString = (value: unknown): value is string =>
  typeof value === 'string' && value !== '';

/**
 * One flow a caller may start, and what the coordinator states into its start
 * input before composing: the vendors' entitlements as it verified them, for a
 * checkout the group's id, which is the flow's own (ADR 0069), and for a
 * delivery the windows it waits in, which are configuration. Whatever the
 * caller sent for any of them is overwritten.
 */
interface FlowStart {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- each recipe has its own input
  readonly recipe: Recipe<any>;
  readonly permission: Permission;
  readonly vendorsOf: (input: Body) => readonly string[];
  readonly state: (
    input: Body,
    entitlements: ReadonlyMap<string, readonly string[]>,
    flowId: string,
    dials: DeliveryDials,
  ) => Body;
}

const vendorPartsOf = (input: Body): readonly Body[] =>
  Array.isArray(input['vendors'])
    ? (input['vendors'] as unknown[]).flatMap(part => {
        const found = recordOf(part);
        return found === undefined ? [] : [found];
      })
    : [];

/**
 * Both start on `order-management:product-order:write`, the permission the
 * saga coordinator's two definitions ran on: a flow that writes orders is
 * started by whoever may have them written, and neither adds an entry to
 * `SERVICE_CROSSING_PERMISSIONS`.
 */
export const FLOW_STARTS = {
  checkout: {
    recipe: checkoutRecipe,
    permission: 'order-management:product-order:write' as Permission,
    vendorsOf: input =>
      vendorPartsOf(input)
        .map(part => part['vendorId'])
        .filter(isString),
    state: (input, entitlements, flowId) => ({
      ...input,
      groupId: flowId,
      vendors: vendorPartsOf(input).map(part => ({
        ...part,
        entitlements: entitlements.get(String(part['vendorId'])) ?? [],
      })),
    }),
  },
  cancellation: {
    recipe: cancellationRecipe,
    permission: 'order-management:product-order:write' as Permission,
    vendorsOf: input => [input['vendorId']].filter(isString),
    state: (input, entitlements) => {
      const verified = entitlements.get(String(input['vendorId'])) ?? [];
      return {
        ...input,
        entitlements: verified,
        // A shipment exists only where the order shipped and the vendor
        // ships at all: a checkout opens none for a vendor not provisioned
        // to, so a hold on it would refuse a cancellation for nothing.
        shipped:
          input['shipped'] === true && verified.includes(SHIPPING_ENTITLEMENT),
      };
    },
  },
  /**
   * Started by fulfilment-service when a vendor dispatches, from the shipment
   * it stores. On `dispatch-step`, the crossing permission of the pivot the
   * flow runs: whoever may have a parcel dispatched may start its delivery,
   * and no new line joins `SERVICE_CROSSING_PERMISSIONS`.
   */
  delivery: {
    recipe: deliveryRecipe,
    permission:
      'shipping-order-management:shipping-order:dispatch-step' as Permission,
    vendorsOf: input => [input['vendorId']].filter(isString),
    state: (input, entitlements, _flowId, dials) => ({
      ...input,
      entitlements: entitlements.get(String(input['vendorId'])) ?? [],
      awaitDeliveryMs: dials.awaitDeliveryMs,
      awaitReturnMs: dials.awaitReturnMs,
    }),
  },
} as const satisfies Readonly<Record<string, FlowStart>>;

/**
 * The coordinator's own verified context. A crossing caller is a service, not
 * a person: it holds no role and no entitlement, so everything a step
 * requires is met — or not — by the vendor segment it runs in.
 */
const COORDINATOR = verifiedContext({
  entitlements: [],
  roles: [],
  flags: [],
  config: {},
});

/** Where a started flow is followed: its status read and the push stream. */
const linksOf = (flowId: string) => [
  { rel: 'status' as const, href: `/api/realtime/flow/${flowId}` },
  { rel: 'stream' as const, href: '/api/realtime/stream' },
];

const startEndpoint = (name: keyof typeof FLOW_STARTS) => {
  const start: FlowStart = FLOW_STARTS[name];
  return implement(
    defineEndpoint({
      name: `start-${name}`,
      method: 'POST',
      path: `/api/flow/${name}`,
      payload: JsonBody,
      success: JsonBody,
      errors: [
        Invalid,
        CompositionRefused,
        FlowRequirementsUnmet,
        Unresolvable,
        UpstreamUnavailable,
        Overloaded,
        // A store's answer to a registration it could not make twice.
        DuplicateKey,
      ],
      guard: {
        kind: 'crossing',
        permission: start.permission,
        organization: false,
      },
      // The engine's registration of the key is the claim: a repeated key
      // answers the flow the first start began, so nothing else records it.
      idempotent: 'unit',
      accepted: true,
    }),
    ({ payload }) =>
      Effect.gen(function* () {
        const key = yield* IdempotencyKeyTag;
        const input = recordOf(payload) ?? {};
        const facts = yield* VendorFactsTag;
        const dials = yield* DeliveryDialsTag;
        const entitlements = yield* facts.entitlementsOf(
          start.vendorsOf(input),
        );
        const flowId = globalThis.crypto.randomUUID();
        const slip = yield* compose(
          start.recipe,
          flowCatalog,
          COORDINATOR,
          recordOf(payload) === undefined
            ? payload
            : start.state(input, entitlements, flowId, dials),
          { flowId, composedAt: new Date().toISOString() },
        );
        const engine = yield* FlowEngineTag;
        const started = yield* engine.start(slip, key);
        return makeEnvelope('flowAccepted', name, {
          flowId: started.flowId,
          links: linksOf(started.flowId),
        });
      }),
  );
};

/**
 * `POST /api/flow/checkout`, `/cancellation` and `/delivery` — a flow
 * started, answered `202` with what to follow, never with its outcome
 * (ADR 0066, ADR 0073). One endpoint per recipe so each carries its own
 * permission; the coordinator composes from what it verified, validates, and
 * hands the slip to the engine.
 */
export const flowStartEndpoints = [
  startEndpoint('checkout'),
  startEndpoint('cancellation'),
  startEndpoint('delivery'),
] as const;
