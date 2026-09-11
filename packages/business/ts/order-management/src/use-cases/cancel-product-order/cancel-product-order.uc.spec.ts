import {
  describeEntityUseCases,
  EntifixLogicError,
} from '@r10c/entifix-ts-core';
import { describe, expect, it } from 'vitest';

import { ProductOrder } from '../../entities/product-order/index.js';
import {
  CANCEL_PRODUCT_ORDER,
  CancelProductOrderUC,
  MULTI_VENDOR_ORDER,
  ORDER_NOT_CANCELLABLE,
} from './cancel-product-order.uc.js';

const line = (vendorId: string) => ({ vendorId });

/** The `code` a route reads off the failure to render a translated message. */
const codeOf = (run: () => void): string | undefined => {
  try {
    run();
  } catch (error) {
    return error instanceof EntifixLogicError
      ? (error.details as { code?: string } | undefined)?.code
      : undefined;
  }
  return undefined;
};

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

  it('allows an operator to cancel any paid order', () => {
    expect(() =>
      CancelProductOrderUC.run(
        { status: 'paid' },
        [line('alpha'), line('beta')],
        undefined,
      ),
    ).not.toThrow();
  });

  it('allows a vendor an order that is theirs alone', () => {
    expect(() =>
      CancelProductOrderUC.run(
        { status: 'paid' },
        [line('alpha'), line('alpha')],
        'alpha',
      ),
    ).not.toThrow();
  });

  it('refuses a vendor an order that names somebody else', () => {
    expect(
      codeOf(() =>
        CancelProductOrderUC.run(
          { status: 'paid' },
          [line('alpha'), line('beta')],
          'alpha',
        ),
      ),
    ).toBe(MULTI_VENDOR_ORDER);
  });

  it('answers the vendor question before the status one', () => {
    // "Not cancellable right now" reads as a retry, and there is no moment at
    // which a vendor's cancel of a shared basket succeeds.
    expect(
      codeOf(() =>
        CancelProductOrderUC.run(
          { status: 'pending' },
          [line('alpha'), line('beta')],
          'alpha',
        ),
      ),
    ).toBe(MULTI_VENDOR_ORDER);
  });

  it('refuses every state but paid', () => {
    for (const status of ['pending', 'cancelling', 'cancelled', 'fulfilled']) {
      expect(
        codeOf(() =>
          CancelProductOrderUC.run(
            { status: status as never },
            [line('alpha')],
            undefined,
          ),
        ),
      ).toBe(ORDER_NOT_CANCELLABLE);
    }
  });
});
