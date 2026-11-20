import { ProductOrder } from '@r10c/business-ts-order-management';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  makeSimulatedFiscalCertifier,
  readCertifierOutcome,
  SIMULATED_REJECTION,
  SimulatedFiscalCertifierLayer,
} from './simulated-fiscal-certifier.js';

const AT = new Date('2026-11-20T12:00:00.000Z');

const anOrder = (id: string, regime: ProductOrder['sellerTaxRegime']) =>
  Object.assign(new ProductOrder('b'), { id, sellerTaxRegime: regime });

describe('readCertifierOutcome', () => {
  it('reads the two failure outcomes and defaults to certifying', () => {
    expect(
      ['reject', 'unavailable', 'certify', 'nonsense', ''].map(
        readCertifierOutcome,
      ),
    ).toEqual(['reject', 'unavailable', 'certify', 'certify', 'certify']);
  });
});

describe('the simulated FEL certifier', () => {
  const certifier = makeSimulatedFiscalCertifier('certify');

  it('issues the same document for the same order, however often it is asked', async () => {
    const first = await Effect.runPromise(
      certifier.certify(anOrder('o-1', 'general'), AT),
    );
    const again = await Effect.runPromise(
      certifier.certify(anOrder('o-1', 'general'), AT),
    );
    const other = await Effect.runPromise(
      certifier.certify(anOrder('o-2', 'general'), AT),
    );

    expect(first).toEqual(again);
    expect(first).not.toEqual(other);
    expect(first).toMatchObject({
      _tag: 'done',
      value: { type: 'FACT', certifiedAt: AT },
    });
    const { value } = first as {
      value: { authorization: string; series: string; number: string };
    };
    expect(value.authorization).toMatch(
      /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/,
    );
    expect(value.series).toBe(value.authorization.slice(0, 8));
    expect(value.number).toMatch(/^\d+$/);
  });

  it('picks the document type by the seller’s regime', async () => {
    const answer = await Effect.runPromise(
      certifier.certify(anOrder('o-1', 'small-taxpayer'), AT),
    );
    expect(answer).toMatchObject({ value: { type: 'FPEQ' } });
  });

  it('voids with an authorization of its own', async () => {
    const order = anOrder('o-1', 'general');
    const certified = await Effect.runPromise(certifier.certify(order, AT));
    const voided = await Effect.runPromise(certifier.void(order, 'x', AT));

    expect(voided).toMatchObject({ _tag: 'done', value: { voidedAt: AT } });
    expect(
      (voided as { value: { authorization: string } }).value.authorization,
    ).not.toBe(
      (certified as { value: { authorization: string } }).value.authorization,
    );
  });

  it('refuses when told to, with a reason', async () => {
    const refusing = makeSimulatedFiscalCertifier('reject');
    expect(
      await Effect.runPromise(
        refusing.void(anOrder('o-1', 'general'), 'x', AT),
      ),
    ).toEqual({ _tag: 'rejected', reason: SIMULATED_REJECTION });
  });

  it('goes silent when told to', async () => {
    const silent = makeSimulatedFiscalCertifier('unavailable');
    const failure = await Effect.runPromise(
      Effect.flip(silent.certify(anOrder('o-1', 'general'), AT)),
    );
    expect(failure).toMatchObject({ code: 'unavailable' });
  });

  it('is provided as a layer', () => {
    expect(SimulatedFiscalCertifierLayer('certify')).toBeDefined();
  });
});
