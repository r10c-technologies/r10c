import { describeEntityUseCases } from '@entifix/core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { ProductOrder } from '../../entities/product-order/index.js';
import {
  CONFIRM_PAYMENT,
  ConfirmPaymentUC,
  SET_PAYMENT_LINK,
  SetPaymentLinkUC,
} from './payment-link.uc.js';

describe('the payment-link verbs', () => {
  it('derive their permissions from the entity and the verb', () => {
    expect(CONFIRM_PAYMENT).toBe(
      'order-management:product-order:confirm-payment',
    );
    expect(SET_PAYMENT_LINK).toBe(
      'order-management:product-order:set-payment-link',
    );
  });

  it('are offered only while the order waits for its payment', () => {
    const useCases = describeEntityUseCases(ProductOrder);
    for (const key of ['confirm-payment', 'set-payment-link']) {
      expect(useCases.find(useCase => useCase.key === key)).toMatchObject({
        binding: 'entity',
        availableWhen: { member: 'status', in: ['awaiting-payment'] },
      });
    }
  });

  it.each([ConfirmPaymentUC, SetPaymentLinkUC])(
    'allows a waiting order and refuses any other',
    async verb => {
      await expect(
        Effect.runPromise(verb.run({ id: 'o-1', status: 'awaiting-payment' })),
      ).resolves.toBeUndefined();
      const refused = await Effect.runPromise(
        Effect.flip(verb.run({ id: 'o-1', status: 'cancelled' })),
      );
      expect(refused).toMatchObject({
        code: 'orderNotAwaitingPayment',
        orderId: 'o-1',
        standing: 'cancelled',
      });
    },
  );
});
