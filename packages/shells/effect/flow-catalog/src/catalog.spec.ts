import {
  compose,
  type CompositionOutcome,
  enumerateCompositions,
  expectAllCompositionsValid,
} from '@entifix/business/compose';
import { catalogDocument, slipSteps } from '@entifix/business/flow';
import { verifiedContext } from '@entifix/business/verified';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  cancellationRecipe,
  checkoutRecipe,
  type CheckoutStart,
  FLOW_RECIPES,
  flowCatalog,
  PAYMENT_METHODS,
} from './catalog.js';

/** Every subset of the entitlements a fragment can require. */
const ENTITLEMENT_SETS: readonly (readonly string[])[] = [
  [],
  ['stock-management'],
];

const contexts = ENTITLEMENT_SETS.map(entitlements => ({
  label: `entitled to [${entitlements.join(', ')}]`,
  value: verifiedContext({ entitlements, roles: [], flags: [], config: {} }),
}));

const checkoutInputs = PAYMENT_METHODS.flatMap(paymentMethod =>
  [['v-1'], ['v-1', 'v-2']].map(vendors => ({
    label: `${paymentMethod} × ${String(vendors.length)} vendor(s)`,
    value: { paymentMethod, vendors } satisfies CheckoutStart,
  })),
);

/**
 * A combination refused only because the caller is not entitled to a step is
 * a caller offered nothing, not a defect in the recipe.
 */
const notOffered = (outcome: CompositionOutcome) =>
  outcome.outcome === 'refused' &&
  outcome.violations.every(violation => violation.tag === 'UnmetRequirement');

const defects = (outcomes: readonly CompositionOutcome[]) =>
  outcomes.filter(outcome => !notOffered(outcome));

describe('the flow catalog', () => {
  it('composes every checkout an entitled caller can ask for', () => {
    const outcomes = enumerateCompositions(checkoutRecipe, flowCatalog, {
      contexts,
      inputs: checkoutInputs,
    });

    expect(outcomes).toHaveLength(8);
    expect(() => expectAllCompositionsValid(defects(outcomes))).not.toThrow();
    // The unentitled half is exactly the combinations the entitlement gates.
    expect(outcomes.filter(notOffered).map(outcome => outcome.context)).toEqual(
      Array(4).fill('entitled to []'),
    );
  });

  it('composes every cancellation', () => {
    const outcomes = enumerateCompositions(cancellationRecipe, flowCatalog, {
      contexts,
      inputs: [{ label: 'an order', value: { orderId: 'o-1' } }],
    });

    expect(() => expectAllCompositionsValid(defects(outcomes))).not.toThrow();
  });

  // The recipes reproduce today's sagas step for step until the engine runs
  // them (#486, #487).
  it("composes today's card checkout in its saga's order", () => {
    const slip = Effect.runSync(
      compose(
        checkoutRecipe,
        flowCatalog,
        (contexts[1] as (typeof contexts)[number]).value,
        { paymentMethod: 'card', vendors: ['v-1'] },
        { flowId: 'f', composedAt: '2026-10-28T00:00:00.000Z' },
      ),
    );

    expect(slipSteps(slip).map(step => step.ref)).toEqual([
      'stock.reserve@1',
      'order.write@1',
      'payment.capture@1',
      'stock.convert@1',
    ]);
  });

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
