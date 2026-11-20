import { Unavailable } from '@entifix/core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { CheckoutGroup } from '../../entities/checkout-group/index.js';
import { ProductOrder } from '../../entities/product-order/index.js';
import {
  type CertifierAnswer,
  type FiscalCertifier,
  FiscalCertifierTag,
} from '../../ports/fiscal-certifier.js';
import {
  type ProductOrderStore,
  ProductOrderStoreTag,
} from '../../ports/product-order-store.js';
import { makeInMemoryOrderStores } from '../../testing/in-memory-product-order-store.js';
import type {
  FiscalDocument,
  FiscalVoid,
} from '../../values/fiscal-document.js';
import { OrderItem } from '../../values/order-item.js';
import {
  CERTIFIER_UNAVAILABLE,
  certifyFiscalDocuments,
  VOID_REASON,
} from './fiscal-certification.js';

const NOW = new Date('2026-11-20T12:00:00.000Z');
const BACKOFF = 60_000;

type Answer<A> = CertifierAnswer<A> | 'unavailable';

/** A certifier that answers what it is told and remembers what it was asked. */
const certifier = (
  certify: Answer<FiscalDocument>,
  annul: Answer<FiscalVoid> = {
    _tag: 'done',
    value: { authorization: 'VOID-1', voidedAt: NOW },
  },
) => {
  const asked: string[] = [];
  const reply = <A>(answer: Answer<A>) =>
    answer === 'unavailable'
      ? Effect.fail(new Unavailable({ dependency: 'certifier' }))
      : Effect.succeed(answer);
  const port: FiscalCertifier = {
    certify: order => {
      asked.push(`certify:${String(order.id)}`);
      return reply(certify);
    },
    void: (order, reason) => {
      asked.push(`void:${String(order.id)}:${reason}`);
      return reply(annul);
    },
  };
  return { port, asked };
};

const DOCUMENT: FiscalDocument = {
  type: 'FACT',
  authorization: 'AUTH-1',
  series: 'SER1',
  number: '1',
  certifiedAt: NOW,
};

const world = async () => {
  const stores = makeInMemoryOrderStores();
  await Effect.runPromise(
    stores.groups.open(
      Object.assign(new CheckoutGroup(), { id: 'g' }),
      undefined,
    ),
  );
  for (const id of ['o-1', 'o-2']) {
    await Effect.runPromise(
      stores.orders.place(
        Object.assign(new ProductOrder('b'), {
          id,
          vendorId: 'v',
          groupId: 'g',
          items: [new OrderItem('x', 'Tornillo', 1, 10, 'GTQ')],
        }),
        undefined,
      ),
    );
  }
  await Effect.runPromise(
    stores.orders.markPaid(
      { consumer: 'c', eventId: 'e' },
      'o-1',
      NOW.toISOString(),
    ),
  );
  return stores.orders;
};

const pass = (orders: ProductOrderStore, port: FiscalCertifier, now = NOW) =>
  Effect.runPromise(
    certifyFiscalDocuments(now, BACKOFF).pipe(
      Effect.provideService(ProductOrderStoreTag, orders),
      Effect.provideService(FiscalCertifierTag, port),
    ),
  );

describe('certifyFiscalDocuments', () => {
  it('certifies a paid order once, and leaves an unpaid one alone', async () => {
    const orders = await world();
    const { port, asked } = certifier({ _tag: 'done', value: DOCUMENT });

    const first = await pass(orders, port);
    const second = await pass(orders, port);

    expect(first).toEqual({ certified: 1, voided: 0, failed: 0 });
    expect(second).toEqual({ certified: 0, voided: 0, failed: 0 });
    expect(asked).toEqual(['certify:o-1']);
    expect(await Effect.runPromise(orders.get('o-1'))).toMatchObject({
      status: 'paid',
      fiscalAuthorization: 'AUTH-1',
    });
  });

  it.each([
    ['a refusal', { _tag: 'rejected', reason: 'NIT inválido' } as const],
    ['no answer', 'unavailable' as const],
  ])(
    'records %s without touching the payment, and retries after the backoff',
    async (_, answer) => {
      const orders = await world();

      const failed = await pass(orders, certifier(answer).port);
      const tooSoon = await pass(orders, certifier(answer).port);
      const later = await pass(
        orders,
        certifier({ _tag: 'done', value: DOCUMENT }).port,
        new Date(NOW.getTime() + BACKOFF + 1),
      );

      expect(failed).toEqual({ certified: 0, voided: 0, failed: 1 });
      expect(tooSoon).toEqual({ certified: 0, voided: 0, failed: 0 });
      expect(later).toEqual({ certified: 1, voided: 0, failed: 0 });
    },
  );

  it.each([
    [
      'a refusal',
      { _tag: 'rejected', reason: 'NIT inválido' } as const,
      'NIT inválido',
    ],
    ['no answer', 'unavailable' as const, CERTIFIER_UNAVAILABLE],
  ])('keeps %s on the order while it stands', async (_, answer, reason) => {
    const orders = await world();
    await pass(orders, certifier(answer).port);
    expect(await Effect.runPromise(orders.get('o-1'))).toMatchObject({
      status: 'paid',
      fiscalFailure: reason,
    });
  });

  it('voids the document of an order cancelled after it was certified', async () => {
    const orders = await world();
    await pass(orders, certifier({ _tag: 'done', value: DOCUMENT }).port);
    await Effect.runPromise(orders.claimCancellation('o-1', undefined));
    await Effect.runPromise(orders.settleCancellation('o-1', undefined));
    const { port, asked } = certifier({ _tag: 'done', value: DOCUMENT });

    const voided = await pass(orders, port);
    const refused = await pass(
      orders,
      certifier(
        { _tag: 'done', value: DOCUMENT },
        { _tag: 'rejected', reason: 'x' },
      ).port,
    );

    expect(voided).toEqual({ certified: 0, voided: 1, failed: 0 });
    expect(refused).toEqual({ certified: 0, voided: 0, failed: 0 });
    expect(asked).toEqual([`void:o-1:${VOID_REASON}`]);
  });

  it('counts a refused annulment as a failure', async () => {
    const orders = await world();
    await pass(orders, certifier({ _tag: 'done', value: DOCUMENT }).port);
    await Effect.runPromise(orders.claimCancellation('o-1', undefined));
    await Effect.runPromise(orders.settleCancellation('o-1', undefined));

    const refused = await pass(
      orders,
      certifier(
        { _tag: 'done', value: DOCUMENT },
        { _tag: 'rejected', reason: 'fuera de plazo' },
      ).port,
    );

    expect(refused).toEqual({ certified: 0, voided: 0, failed: 1 });
  });

  it('skips an order another pass recorded while the certifier answered', async () => {
    const orders = await world();
    const racing: ProductOrderStore = {
      ...orders,
      recordFiscalDocument: () => Effect.succeed(false),
    };
    expect(
      await pass(racing, certifier({ _tag: 'done', value: DOCUMENT }).port),
    ).toEqual({ certified: 0, voided: 0, failed: 0 });
  });

  it('skips an order another pass already holds', async () => {
    const orders = await world();
    const held: ProductOrderStore = {
      ...orders,
      claimFiscalAttempt: () => Effect.succeed(undefined),
    };
    const { port, asked } = certifier({ _tag: 'done', value: DOCUMENT });
    expect(await pass(held, port)).toEqual({
      certified: 0,
      voided: 0,
      failed: 0,
    });
    expect(asked).toEqual([]);
  });
});
