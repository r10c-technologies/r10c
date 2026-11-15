import { describe, expect, it } from 'vitest';

import { SETTLEMENT_SEARCH_SOURCES } from './search-sources';
import {
  MARKETPLACE_SERVICE_URL,
  SETTLEMENT_SERVICE_URL,
} from './service-urls';

/**
 * The declarations are validated against live entity metadata the moment this
 * module loads, so the import itself is most of the test: dropping the
 * `references` declaration from `Agreement.vendorId` fails *here*, loudly,
 * rather than in a palette that quietly reports a group it could not reach.
 *
 * Every source is searched through the vendor it belongs to (#552): the term
 * is matched against the vendor's display name in marketplace-service's
 * published-vendor projection, and the records referring to the matches are
 * read here and named after them.
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
  ])('names a %s result after its vendor, and routes it here', (key, href) => {
    const source = SETTLEMENT_SEARCH_SOURCES.find(
      candidate => candidate.key === key,
    );

    const option = source?.read(
      {
        meta: { type: 'entityPage', entity: key },
        data: { items: [{ id: 'x-1', vendorId: 'org-1' }], total: 1 },
      },
      'es',
      new Map([['org-1', 'Cerámica Demo']]),
    )?.items[0];

    expect(option).toMatchObject({ label: 'Cerámica Demo', href });
  });

  it('matches the vendor’s name at marketplace-service, then reads here', () => {
    // ADR 0040's fan-out runs server-side, so it dials both services directly —
    // unlike the browser's adapters, which go through the host's same-origin
    // proxy because that is what carries the session cookie.
    for (const source of SETTLEMENT_SEARCH_SOURCES) {
      expect(
        source.through
          ?.url('ceramica', 5, 'es')
          .startsWith(`${MARKETPLACE_SERVICE_URL}/api/published-vendor?`),
      ).toBe(true);
      expect(
        source.through
          ?.urlFor(['org-1'], 5)
          .startsWith(`${SETTLEMENT_SERVICE_URL}/api/${source.key}?`),
      ).toBe(true);
    }
  });
});

describe('MARKETPLACE_SERVICE_URL', () => {
  it('defaults to the port the fleet convention allocates', () => {
    expect(MARKETPLACE_SERVICE_URL).toBe(
      process.env.MARKETPLACE_SERVICE_URL ?? 'http://localhost:3100',
    );
  });
});
