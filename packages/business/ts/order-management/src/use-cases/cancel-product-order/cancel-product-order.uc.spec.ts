import { describeEntityUseCases } from '@entifix/core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { ProductOrder } from '../../entities/product-order/index.js';
import {
  CANCEL_PRODUCT_ORDER,
  CancelProductOrderUC,
} from './cancel-product-order.uc.js';

/** The refusal's `code`, or `undefined` when the decider allows it. */
const codeOf = (...args: Parameters<typeof CancelProductOrderUC.run>) =>
  Effect.runSync(
    CancelProductOrderUC.run(...args).pipe(
      Effect.as(undefined),
      Effect.catch(refusal => Effect.succeed(refusal.code)),
    ),
  );

describe('CancelProductOrderUC', () => {
  it('derives its permission from the entity and the verb', () => {
    expect(CANCEL_PRODUCT_ORDER).toBe('order-management:product-order:cancel');
  });

  it('registers itself onto the entity, with a destructive confirmation', () => {
    const useCases = describeEntityUseCases(ProductOrder);
    const cancel = useCases.find(useCase => useCase.key === 'cancel');

    expect(cancel?.binding).toBe('entity');
    expect(cancel?.placement).toBe('context-independent');
    // Money moves and nothing here is reversible: un-refunding is charging a
    // customer again.
    expect(cancel?.confirm?.tone).toBe('destructive');
    expect(cancel?.confirm?.messageKey).toBe(
      'entity:product-order.useCases.cancelConfirm',
    );
  });

  it.each(['paid', 'confirmed'])('allows cancelling a %s order', status => {
    expect(codeOf({ id: 'o-1', status: status as never })).toBeUndefined();
  });

  it('refuses every state but paid and confirmed, naming the order and its status', () => {
    for (const status of [
      'pending',
      'cancelling',
      'dispatched',
      'cancelled',
      'fulfilled',
    ]) {
      const refused = Effect.runSync(
        Effect.flip(
          CancelProductOrderUC.run({ id: 'o-1', status: status as never }),
        ),
      );
      expect(refused).toMatchObject({
        _tag: 'OrderNotCancellable',
        code: 'orderNotCancellable',
        orderId: 'o-1',
        reason: `an order in '${status}' cannot be cancelled`,
      });
    }
  });
});
