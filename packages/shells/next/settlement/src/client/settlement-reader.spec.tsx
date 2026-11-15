import { describe, expect, it } from 'vitest';

import {
  AGREEMENT_SURFACE,
  COMMISSION_ENTRY_SURFACE,
  SETTLEMENT_RUN_SURFACE,
  VENDOR_PAYOUT_SURFACE,
} from '../settlement-surfaces.js';
import { settlementListView } from './settlement-reader.js';

/**
 * A vendor reads their own statement in their own words (#559): every row is
 * theirs, so the list is titled for them and carries no column repeating their
 * name. An operator, reading across vendors, keeps both. Copy only — what
 * either may read is the service's decision (ADR 0015).
 */
describe('a settlement list for whoever reads it', () => {
  it.each([
    [AGREEMENT_SURFACE.entityKey, 'r10c:settlement.nav.agreements_vendor'],
    [COMMISSION_ENTRY_SURFACE.entityKey, 'r10c:settlement.nav.entries_vendor'],
    [VENDOR_PAYOUT_SURFACE.entityKey, 'r10c:settlement.nav.payouts_vendor'],
  ])('words %s for a vendor, without the vendor column', (key, titleKey) => {
    expect(settlementListView(key, 'vendor')).toEqual({
      titleKey,
      hiddenColumns: ['vendorId'],
    });
  });

  it('leaves a list it does not word as the entity names it', () => {
    expect(
      settlementListView(SETTLEMENT_RUN_SURFACE.entityKey, 'vendor'),
    ).toEqual({});
  });

  it('leaves every list as it is for an operator, or nobody named', () => {
    expect(
      settlementListView(VENDOR_PAYOUT_SURFACE.entityKey, 'operator'),
    ).toEqual({});
    expect(
      settlementListView(VENDOR_PAYOUT_SURFACE.entityKey, undefined),
    ).toEqual({});
  });
});
