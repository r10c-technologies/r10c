import { describe, expect, it } from 'vitest';

import { cancellationSaga } from './cancellation.saga.js';
import { checkoutSaga } from './checkout.saga.js';
import { SAGAS } from './index.js';

/**
 * ⚠️ **The point of this file is that it imports the definitions at all.**
 * `defineSaga` validates at module load, and `saga-definition.ts` says as much:
 * a definition that never loads is a definition that never fails. Until this
 * existed, both flows were only evaluated transitively through the router — so
 * an invalid shape would have surfaced as a service that refused to boot in the
 * lab rather than as a red test.
 *
 * The assertions below are about the two properties a reader cannot check by
 * eye: that the registry holds what the router will look up, and that the
 * cancellation's pivot sits where the pattern requires.
 */
describe('The saga registry', () => {
  it('registers every definition under its own name', () => {
    // `POST /api/saga/:definition` looks the segment up in this map, and the
    // resume sweep logs an error rather than resuming an instance whose
    // definition is missing — so a flow served but unregistered would run once
    // and never be finished if its coordinator died.
    expect(Object.keys(SAGAS).sort()).toEqual(['cancellation', 'checkout']);
    expect(SAGAS['checkout']).toBe(checkoutSaga);
    expect(SAGAS['cancellation']).toBe(cancellationSaga);
  });

  it('names each definition the same as its registry key', () => {
    for (const [key, definition] of Object.entries(SAGAS)) {
      expect(definition.name).toBe(key);
    }
  });
});

describe('The cancellation flow', () => {
  const stepIds = cancellationSaga.steps.map(step => step.id);

  it('claims, refunds, restores and settles, in that order', () => {
    expect(stepIds).toEqual(['claim', 'refund', 'restore-stock', 'settle']);
  });

  it('puts the refund at the point of no return', () => {
    const pivots = cancellationSaga.steps.filter(step => step.kind === 'pivot');
    expect(pivots.map(step => step.id)).toEqual(['refund']);
  });

  it('reverses the claim and nothing else', () => {
    // Everything before the pivot reverses; nothing after it does. A
    // compensation declared on a retriable step would be a false assurance, and
    // `defineSaga` refuses one — so this asserts the shape that survived it.
    const compensated = cancellationSaga.steps.filter(
      step => step.compensation !== undefined,
    );
    expect(compensated.map(step => step.id)).toEqual(['claim']);
  });

  it('addresses the claim compensation from the claim’s own response', () => {
    // A compensation's template resolves against its own call's response body
    // and nothing else — no inputs, no earlier steps — so `{input.orderId}`
    // here would throw at compensation time and strand a reversible flow.
    const claim = cancellationSaga.steps.find(step => step.id === 'claim');
    expect(claim?.compensation?.path).toContain('{outcome.');
    expect(claim?.compensation?.path).not.toContain('{input.');
  });

  it('fans the stock restoration out over the caller’s own inputs', () => {
    // Not `fanOutFrom`: by the time an order is paid the hold is spent, so a
    // restoration addresses nothing an earlier step created. The lines come
    // from the entry route, and each carries the organization the crossing
    // needs.
    const restore = cancellationSaga.steps.find(
      step => step.id === 'restore-stock',
    );
    expect(restore?.fanOut).toBe(true);
    expect(restore?.fanOutFrom).toBeUndefined();
  });

  it('runs on a permission the crossing list already closes over', () => {
    // `requireCrossing` resolves this string against
    // `SERVICE_CROSSING_PERMISSIONS`, which admits no wildcards — a definition
    // naming a permission absent from that list answers 403 at runtime and
    // nowhere earlier.
    expect(cancellationSaga.permission).toBe(
      'order-management:product-order:write',
    );
  });
});
