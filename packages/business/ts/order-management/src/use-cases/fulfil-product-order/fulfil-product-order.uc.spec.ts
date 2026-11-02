import { describeEntityUseCases } from '@entifix/core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { ProductOrder } from '../../entities/product-order/index.js';
import {
  FULFIL_PRODUCT_ORDER,
  FulfilProductOrderUC,
} from './fulfil-product-order.uc.js';

const AT = new Date('2026-09-11T12:00:00.000Z');
const EARLIER = new Date('2026-09-10T08:00:00.000Z');

const decide = (...args: Parameters<typeof FulfilProductOrderUC.run>) =>
  Effect.runSync(FulfilProductOrderUC.run(...args));

const line = (vendorId: string, fulfilledAt?: Date) => ({
  vendorId,
  fulfilledAt,
});

describe('FulfilProductOrderUC', () => {
  it('derives its permission from the entity and the verb', () => {
    // Imported at the call site rather than retyped: the source scan checks
    // this against the grant table, which is the only other place the string
    // `fulfil` is written.
    expect(FULFIL_PRODUCT_ORDER).toBe('order-management:product-order:fulfil');
  });

  it('registers itself onto the entity it names', () => {
    // A descriptor the entity does not carry is a button `$metadata` never
    // serves, and the registration happens when this module evaluates.
    const useCases = describeEntityUseCases(ProductOrder);
    const fulfil = useCases.find(useCase => useCase.key === 'fulfil');

    expect(fulfil?.binding).toBe('entity');
    expect(fulfil?.placement).toBe('context-independent');
    // No confirmation: nothing moves and nothing is lost, so a dialog would be
    // friction in front of a stamp.
    expect(fulfil?.confirm).toBeUndefined();
  });

  it('stamps every line for an operator and reaches `fulfilled`', () => {
    const result = decide(
      { id: 'o-1', status: 'paid' },
      [line('alpha'), line('beta')],
      undefined,
      AT,
    );

    expect(result.status).toBe('fulfilled');
    expect(result.lines.map(item => item.fulfilledAt)).toEqual([AT, AT]);
  });

  it('stamps one vendor’s lines and leaves the order `paid`', () => {
    // The asymmetry the verb exists for: an order-level `fulfilled` flipped by
    // one vendor states something about another's lines that is not true.
    const result = decide(
      { id: 'o-1', status: 'paid' },
      [line('alpha'), line('beta')],
      'alpha',
      AT,
    );

    expect(result.status).toBe('paid');
    expect(result.lines[0].fulfilledAt).toBe(AT);
    expect(result.lines[1].fulfilledAt).toBeUndefined();
  });

  it('never rewrites a stamp that is already there', () => {
    const result = decide(
      { id: 'o-1', status: 'paid' },
      [line('alpha', EARLIER)],
      'alpha',
      AT,
    );

    expect(result.lines[0].fulfilledAt).toBe(EARLIER);
  });

  it('refuses anything that is not paid, naming the order and its status', () => {
    for (const status of ['pending', 'cancelling', 'cancelled', 'fulfilled']) {
      const refused = Effect.runSync(
        Effect.flip(
          FulfilProductOrderUC.run(
            { id: 'o-1', status: status as never },
            [line('alpha')],
            undefined,
            AT,
          ),
        ),
      );
      expect(refused).toMatchObject({
        _tag: 'OrderNotFulfillable',
        code: 'orderNotFulfillable',
        orderId: 'o-1',
        reason: `an order in '${status}' cannot be fulfilled`,
      });
    }
  });
});
