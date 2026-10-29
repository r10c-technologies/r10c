import {
  defineCatalog,
  flowCommit,
  fragmentRef,
  type Slip,
  validateSlip,
} from '@entifix/business/flow';
import { describe, expect, it } from 'vitest';

import { STOCK_FRAGMENTS, stockConvert, stockReserve } from './stock-fragments.js';

const catalog = defineCatalog([...STOCK_FRAGMENTS, flowCommit]);

const slipOf = (refs: readonly string[]): Slip => ({
  slipVersion: 1,
  flowId: 'f',
  recipe: 'checkout',
  requiresCommitPoint: true,
  stages: [
    {
      name: 'main',
      steps: refs.map(ref => ({ ref, step: ref, cardinality: 'perLine' })),
    },
  ],
  resolution: [],
  composedAt: '2026-10-28T00:00:00.000Z',
});

describe('stock fragments', () => {
  it('are pinned at version 1 and owned by stock-management', () => {
    expect(STOCK_FRAGMENTS.map(fragmentRef)).toEqual([
      'stock.reserve@1',
      'stock.convert@1',
      'stock.restore@1',
    ]);
    expect(new Set(STOCK_FRAGMENTS.map(f => f.module))).toEqual(
      new Set(['stock-management']),
    );
  });

  it('let a conversion consume the hold a reservation provides', () => {
    expect(
      validateSlip(
        slipOf([
          fragmentRef(stockReserve),
          'flow.commit@1',
          fragmentRef(stockConvert),
        ]),
        catalog,
      ),
    ).toEqual([]);
  });

  // A conversion consumes the goods: before the commit point it would have to
  // be compensated, and it cannot be.
  it('refuse stock.convert before the commit point', () => {
    expect(
      validateSlip(
        slipOf([
          fragmentRef(stockReserve),
          fragmentRef(stockConvert),
          'flow.commit@1',
        ]),
        catalog,
      ).map(violation => violation.tag),
    ).toContain('RetriableBeforeCommit');
  });
});
