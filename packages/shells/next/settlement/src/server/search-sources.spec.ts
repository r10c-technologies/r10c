import { describe, expect, it } from 'vitest';

import { SETTLEMENT_SEARCH_SOURCES } from './search-sources';
import { SETTLEMENT_SERVICE_URL } from './service-urls';

/**
 * The declarations are validated against live entity metadata the moment this
 * module loads, so the import itself is most of the test: dropping `sortable`
 * from `Agreement.vendorId` fails *here*, loudly, rather than in a palette that
 * quietly reports a group it could not reach.
 *
 * That guard did fire for this domain. `vendorId` is the only member of any of
 * these entities that a source can name a record by — everything else is a
 * number, a date or an opaque id — and it was filterable and not sortable until
 * this change, which means this file could not have been written at all.
 */
describe('SETTLEMENT_SEARCH_SOURCES', () => {
  /**
   * ⚠️ **Three, not four.** `SettlementRun` has no string member at all, so a
   * source over it would label every result by its status and fill a palette
   * with rows called "Calculada". An entity with nothing nameable contributes no
   * source.
   */
  it('declares the three searchable settlement records, in order', () => {
    expect(SETTLEMENT_SEARCH_SOURCES.map(source => source.key)).toEqual([
      'agreement',
      'commission-entry',
      'vendor-payout',
    ]);
  });

  it('labels each group with the entity’s own plural key', () => {
    expect(SETTLEMENT_SEARCH_SOURCES.map(source => source.labelKey)).toEqual([
      'entity:agreement.plural',
      'entity:commission-entry.plural',
      'entity:vendor-payout.plural',
    ]);
  });

  it.each([
    ['agreement', '/settlement/agreement/x-1'],
    ['commission-entry', '/settlement/commission-entry/x-1'],
    ['vendor-payout', '/settlement/vendor-payout/x-1'],
  ])('routes a %s result to a page this host serves', (key, expected) => {
    const source = SETTLEMENT_SEARCH_SOURCES.find(
      candidate => candidate.key === key,
    );

    const href = source?.read({
      meta: { type: 'entityPage', entity: key },
      data: { items: [{ id: 'x-1' }], total: 1 },
    })?.items[0]?.href;

    expect(href).toBe(expected);
  });

  it('fans out to settlement-service, not to the app’s proxy', () => {
    // ADR 0040's fan-out runs server-side, so it dials the service directly —
    // unlike the browser's adapters, which go through the host's same-origin
    // proxy because that is what carries the session cookie.
    for (const source of SETTLEMENT_SEARCH_SOURCES) {
      expect(source.url('x', 5).startsWith(SETTLEMENT_SERVICE_URL)).toBe(true);
    }
  });
});
