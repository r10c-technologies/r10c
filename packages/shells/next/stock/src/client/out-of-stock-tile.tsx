'use client';

import type { FilterGroup } from '@entifix/core';
import { LocaleLink, useEntityTotal } from '@entifix/next-shell';
import { SummaryTile, useTranslateKey } from '@entifix/react-controls';
import { StockItem } from '@r10c/business-ts-stock-management';

import { STOCK_ITEM_SURFACE } from '../stock-surfaces';
import { useStockAdapters } from './stock-context';

/** A position with nothing left to sell: none available, or fewer than none. */
export const OUT_OF_STOCK: FilterGroup<StockItem> = {
  operator: 'and',
  values: [{ property: 'available', operator: 'lte', value: 0 }],
};

/**
 * The vendor home's stock tile (#563, ADR 0077): how many positions have
 * nothing available to sell, one activation from the stock list, which opens
 * with exactly those first (#555). Counted through this shell's own adapter,
 * so it is the list's own read and authorization.
 */
export function OutOfStockTile() {
  const translateKey = useTranslateKey();
  const { stockItemRest } = useStockAdapters();
  const { state, total, retry } = useEntityTotal({
    entity: StockItem,
    ctx: stockItemRest,
    filtering: OUT_OF_STOCK,
  });

  return (
    <SummaryTile
      label={translateKey('r10c:stock.home.outOfStock')}
      href={STOCK_ITEM_SURFACE.basePath}
      count={total}
      state={state}
      onRetry={retry}
      renderLink={({ href, className, children }) => (
        <LocaleLink href={href} className={className}>
          {children}
        </LocaleLink>
      )}
    />
  );
}
