/**
 * The flows the documentation site draws, composed by the same `compose` the
 * coordinator runs (ADR 0065) from the recipes and the catalog in
 * `@r10c/shells-effect-flow-catalog`. The site may not import a shell, so what
 * it reads is this module's output, written to `out/flow-catalog.json` by
 * `generate.ts` (#687).
 *
 * A scenario is a start the coordinator could be handed: one vendor, so every
 * step reads as one box, and every value the slip pins is a placeholder,
 * because a slip's parameters are dropped from the document anyway.
 */
import { compose } from '@entifix/business/compose';
import { catalogDocument, type Slip } from '@entifix/business/flow';
import { verifiedContext } from '@entifix/business/verified';
import {
  cancellationRecipe,
  type CancellationStart,
  checkoutRecipe,
  type CheckoutStart,
  deliveryRecipe,
  type DeliveryStart,
  FLOW_RECIPES,
  flowCatalog,
} from '@r10c/shells-effect-flow-catalog';
import { Effect } from 'effect';

import { layoutScenario } from './layout.js';

/** A vendor provisioned for every step a flow may take. */
const PROVISIONED = ['stock-management', 'shipping-order-management'];

/** The coordinator holds no entitlement of its own: each segment carries its vendor's. */
const COORDINATOR = verifiedContext({
  entitlements: [],
  roles: [],
  flags: [],
  config: {},
});

const OPTIONS = { flowId: 'flow', composedAt: '2026-01-01T00:00:00.000Z' };

const VENDOR = 'vendor';

const LINE = {
  offeringId: 'offering',
  name: 'Offering',
  specificationId: 'specification',
  specificationVersion: 1,
  saleUnit: 'UN' as const,
  quantity: 1,
  amount: 100,
  pricePer: 1 as const,
  lineTotal: 100,
  currency: 'GTQ',
};

const checkout = (
  channel: 'storefront' | 'counter',
  paymentMethod: 'card' | 'cash' | 'cod' | 'link',
): CheckoutStart => ({
  groupId: OPTIONS.flowId,
  channel:
    channel === 'counter'
      ? { type: 'counter', id: 'channel', name: 'Counter' }
      : { type: 'storefront' },
  vendors: [
    {
      vendorId: VENDOR,
      paymentMethod,
      lines: [LINE],
      entitlements: PROVISIONED,
    },
  ],
  totals: [{ currency: 'GTQ', amount: 100 }],
  capabilityDigest: 'capability',
  cancelDigest: 'cancel',
  paymentWindowMs: 172_800_000,
  paymentGraceMs: 3_600_000,
  ...(channel === 'storefront'
    ? {
        contact: {
          name: 'Buyer',
          phone: '+50200000000',
          email: 'buyer@example.com',
          destination: {
            departamento: '01',
            municipio: '0101',
            zona: 1,
            addressLine: 'Address',
          },
        },
        locale: 'es',
      }
    : {}),
});

const RETURNED = [{ offeringId: 'offering', unit: 'UN' as const, quantity: 1 }];

const cancellation: CancellationStart = {
  orderId: 'order',
  vendorId: VENDOR,
  paymentMethod: 'card',
  lines: RETURNED,
  shipped: true,
  entitlements: PROVISIONED,
};

const delivery: DeliveryStart = {
  shippingOrderId: 'order',
  orderId: 'order',
  groupId: 'group',
  vendorId: VENDOR,
  paymentMethod: 'cod',
  amountDue: 100,
  taxableBase: 89,
  taxAmount: 11,
  taxRegime: 'general',
  currency: 'GTQ',
  lines: RETURNED,
  entitlements: PROVISIONED,
  awaitDeliveryMs: 1_209_600_000,
  awaitReturnMs: 2_592_000_000,
};

/**
 * The MVP flow, in the order a sale lives it: four ways to buy, then what
 * follows a paid order. Its ids are the site's page names.
 */
export const SCENARIOS = [
  {
    id: 'checkout-card',
    slip: () =>
      compose(
        checkoutRecipe,
        flowCatalog,
        COORDINATOR,
        checkout('storefront', 'card'),
        OPTIONS,
      ),
  },
  {
    id: 'checkout-cash-on-delivery',
    slip: () =>
      compose(
        checkoutRecipe,
        flowCatalog,
        COORDINATOR,
        checkout('storefront', 'cod'),
        OPTIONS,
      ),
  },
  {
    id: 'checkout-payment-link',
    slip: () =>
      compose(
        checkoutRecipe,
        flowCatalog,
        COORDINATOR,
        checkout('storefront', 'link'),
        OPTIONS,
      ),
  },
  {
    id: 'checkout-counter',
    slip: () =>
      compose(
        checkoutRecipe,
        flowCatalog,
        COORDINATOR,
        checkout('counter', 'cash'),
        OPTIONS,
      ),
  },
  {
    id: 'delivery',
    slip: () =>
      compose(deliveryRecipe, flowCatalog, COORDINATOR, delivery, OPTIONS),
  },
  {
    id: 'cancellation',
    slip: () =>
      compose(
        cancellationRecipe,
        flowCatalog,
        COORDINATOR,
        cancellation,
        OPTIONS,
      ),
  },
] as const;

/** What the site draws a step from — a slip step without what it was composed for. */
export interface ScenarioStep {
  readonly ref: string;
  readonly step: string;
  readonly participant?: string;
  readonly call?: { readonly method: string; readonly path: string };
  readonly compensation?: { readonly method: string; readonly path: string };
  readonly guard?: {
    readonly wait: string;
    readonly outcomes: readonly string[];
  };
}

export interface ScenarioDocument {
  readonly id: string;
  readonly recipe: string;
  readonly stages: readonly {
    readonly name: string;
    readonly steps: readonly ScenarioStep[];
  }[];
}

/**
 * A step as the site needs it. The segment prefix is dropped from the name
 * (one vendor, so it says nothing) and its parameters are not carried: they
 * are the placeholders above, not anything a reader should take for data.
 */
const stepOf = (
  step: Slip['stages'][number]['steps'][number],
): ScenarioStep => {
  const local = (name: string) => name.slice(name.lastIndexOf(':') + 1);
  return {
    ref: step.ref,
    step: local(step.step),
    ...(step.participant === undefined
      ? {}
      : { participant: step.participant }),
    ...(step.call === undefined ? {} : { call: step.call }),
    ...(step.compensation === undefined
      ? {}
      : { compensation: step.compensation }),
    ...(step.guard === undefined
      ? {}
      : {
          guard: {
            wait: local(step.guard.wait),
            outcomes: step.guard.outcomes,
          },
        }),
  };
};

/** Every scenario, composed, or a failure naming the one that did not compose. */
export const flowScenarios = (
  scenarios: readonly {
    readonly id: string;
    readonly slip: () => Effect.Effect<Slip, unknown>;
  }[] = SCENARIOS,
): readonly ScenarioDocument[] =>
  scenarios.map(({ id, slip }) => {
    const composed = Effect.runSync(
      slip().pipe(
        Effect.mapError(
          failure =>
            new Error(`docs-reference: scenario '${id}' did not compose`, {
              cause: failure,
            }),
        ),
      ),
    );
    return {
      id,
      recipe: composed.recipe,
      stages: composed.stages.map(stage => ({
        name: stage.name,
        steps: stage.steps.map(stepOf),
      })),
    };
  });

/**
 * The whole document: the scenarios, each laid out, and every fragment they
 * reference as the catalog declares it.
 */
export const flowCatalogDocument = async () => ({
  recipes: Object.keys(FLOW_RECIPES).sort(),
  scenarios: await Promise.all(
    flowScenarios().map(async scenario => ({
      ...scenario,
      layout: await layoutScenario(scenario),
    })),
  ),
  fragments: catalogDocument(flowCatalog).fragments.map(fragment => ({
    ref: fragment.ref,
    id: fragment.id,
    module: fragment.module,
    kind: fragment.kind,
    irreversible: fragment.irreversible,
    readOnly: fragment.readOnly,
    ...(fragment.outcomes === undefined ? {} : { outcomes: fragment.outcomes }),
  })),
});
