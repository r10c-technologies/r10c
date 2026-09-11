import { Agreement } from '@r10c/business-ts-settlement-management';
import { EntifixBuildError } from '@r10c/entifix-ts-core';
import { describe, expect, it } from 'vitest';

import { commissionsForOrder, payoutFor } from './commission';
import type { PlacedOrderLine } from './placed-order';

const line = (
  vendorId: string,
  amount: number,
  quantity: number,
  currency = 'GTQ',
): PlacedOrderLine => ({ vendorId, amount, quantity, currency });

const agreementFor = (
  vendorId: string,
  commissionBasisPoints: number,
  rates?: Record<string, number>,
): Agreement => {
  const agreement = new Agreement(vendorId, commissionBasisPoints);
  if (rates !== undefined) {
    agreement.channelCommissionBasisPoints = rates;
  }
  return agreement;
};

const agreements = (...built: Agreement[]) =>
  new Map(built.map(agreement => [agreement.vendorId, agreement]));

describe('commissionsForOrder', () => {
  it('prices a vendor’s lines at the agreement’s default rate', () => {
    const { commissions } = commissionsForOrder({
      lines: [line('acme', 1000, 2), line('acme', 500, 1)],
      agreements: agreements(agreementFor('acme', 800)),
    });

    // 2500 minor units at 8%.
    expect(commissions).toEqual([
      {
        vendorId: 'acme',
        saleAmount: 2500,
        commissionAmount: 200,
        currency: 'GTQ',
      },
    ]);
  });

  it('multiplies the unit price by the quantity', () => {
    // `amount` on a line is per unit, which is the one thing about the payload
    // that reads wrong if you skim it: a line of 3 at 1000 is a 3000 sale.
    const { commissions } = commissionsForOrder({
      lines: [line('acme', 1000, 3)],
      agreements: agreements(agreementFor('acme', 1000)),
    });

    expect(commissions[0]?.saleAmount).toBe(3000);
    expect(commissions[0]?.commissionAmount).toBe(300);
  });

  it('takes nothing when the channel’s negotiated rate is zero', () => {
    // The whole reason per-channel rates exist, and the trap #94 was opened
    // for: `rates[type] || fallback` charges the full 8% here.
    const { commissions } = commissionsForOrder({
      lines: [line('acme', 1000, 1)],
      channelType: 'counter',
      agreements: agreements(agreementFor('acme', 800, { counter: 0 })),
    });

    expect(commissions[0]?.commissionAmount).toBe(0);
    expect(commissions[0]?.saleAmount).toBe(1000);
  });

  it('falls back to the default for a channel with no explicit rate', () => {
    const { commissions } = commissionsForOrder({
      lines: [line('acme', 1000, 1)],
      channelType: 'storefront',
      agreements: agreements(agreementFor('acme', 800, { counter: 0 })),
    });

    expect(commissions[0]?.commissionAmount).toBe(80);
  });

  it('falls back to the default when the sale came through no channel', () => {
    // A storefront checkout carries no channel at all.
    const { commissions } = commissionsForOrder({
      lines: [line('acme', 1000, 1)],
      agreements: agreements(agreementFor('acme', 800, { counter: 0 })),
    });

    expect(commissions[0]?.commissionAmount).toBe(80);
  });

  it('gives each vendor on a shared basket their own entry', () => {
    // The multi-vendor case ADR 0022 embedded vendor-tagged lines for: one
    // receipt for the buyer, one commission entry per vendor.
    const { commissions } = commissionsForOrder({
      lines: [line('acme', 1000, 1), line('globex', 2000, 1)],
      agreements: agreements(
        agreementFor('acme', 800),
        agreementFor('globex', 500),
      ),
    });

    expect(commissions).toEqual([
      {
        vendorId: 'acme',
        saleAmount: 1000,
        commissionAmount: 80,
        currency: 'GTQ',
      },
      {
        vendorId: 'globex',
        saleAmount: 2000,
        commissionAmount: 100,
        currency: 'GTQ',
      },
    ]);
  });

  it('rounds once per vendor rather than once per line', () => {
    // Two lines of 333 at 2.5% round to 8 each — 16 — while their sum of 666
    // rounds to 17. The entry has to equal the invoice, so the subtotal is what
    // gets rounded.
    const { commissions } = commissionsForOrder({
      lines: [line('acme', 333, 1), line('acme', 333, 1)],
      agreements: agreements(agreementFor('acme', 250)),
    });

    expect(commissions[0]?.commissionAmount).toBe(17);
  });

  it('rounds to nearest rather than down', () => {
    // Flooring would leave the platform systematically short by up to a cent on
    // every sale in the ledger, which over a period is a real number.
    const { commissions } = commissionsForOrder({
      lines: [line('acme', 999, 1)],
      agreements: agreements(agreementFor('acme', 500)),
    });

    expect(commissions[0]?.commissionAmount).toBe(50);
  });

  it('names a vendor with no agreement instead of guessing a rate', () => {
    // There is no default commission in this system — there is a default within
    // an agreement. Inventing one would put a term nobody negotiated into a
    // ledger built to be defensible.
    const { commissions, unpriced } = commissionsForOrder({
      lines: [line('acme', 1000, 1), line('globex', 2000, 1)],
      agreements: agreements(agreementFor('acme', 800)),
    });

    expect(commissions.map(entry => entry.vendorId)).toEqual(['acme']);
    expect(unpriced).toEqual(['globex']);
  });

  it('refuses one vendor’s lines in two currencies', () => {
    // 500 EUR plus 500 GBP is 1000 of nothing, and a commission taken from that
    // number would be charged to a real vendor.
    expect(() =>
      commissionsForOrder({
        lines: [line('acme', 500, 1, 'EUR'), line('acme', 500, 1, 'GBP')],
        agreements: agreements(agreementFor('acme', 800)),
      }),
    ).toThrow(EntifixBuildError);
  });

  it('allows two vendors on one order to use different currencies', () => {
    const { commissions } = commissionsForOrder({
      lines: [line('acme', 1000, 1, 'EUR'), line('globex', 1000, 1, 'GBP')],
      agreements: agreements(
        agreementFor('acme', 800),
        agreementFor('globex', 800),
      ),
    });

    expect(commissions.map(entry => entry.currency)).toEqual(['EUR', 'GBP']);
  });

  it('prices an empty order as nothing at all', () => {
    const { commissions, unpriced } = commissionsForOrder({
      lines: [],
      agreements: agreements(agreementFor('acme', 800)),
    });

    expect(commissions).toEqual([]);
    expect(unpriced).toEqual([]);
  });
});

describe('payoutFor', () => {
  it('pays the gross less the platform’s cut', () => {
    // Not the sum of the commissions, which is what the platform keeps.
    expect(
      payoutFor('acme', [
        { saleAmount: 1000, commissionAmount: 80, currency: 'GTQ' },
        { saleAmount: 2500, commissionAmount: 200, currency: 'GTQ' },
      ]),
    ).toEqual({ amount: 3220, currency: 'GTQ' });
  });

  it('pays the whole sale when the channel takes no commission', () => {
    expect(
      payoutFor('acme', [
        { saleAmount: 1000, commissionAmount: 0, currency: 'GTQ' },
      ]),
    ).toEqual({ amount: 1000, currency: 'GTQ' });
  });

  it('refuses to total one vendor’s entries in two currencies', () => {
    expect(() =>
      payoutFor('acme', [
        { saleAmount: 1000, commissionAmount: 80, currency: 'EUR' },
        { saleAmount: 1000, commissionAmount: 80, currency: 'GBP' },
      ]),
    ).toThrow(EntifixBuildError);
  });

  it('refuses to pay a vendor with no entries', () => {
    expect(() => payoutFor('acme', [])).toThrow(EntifixBuildError);
  });
});
