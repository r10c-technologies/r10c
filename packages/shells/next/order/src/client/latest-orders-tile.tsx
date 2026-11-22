'use client';

import { type EntityRepositoryTag, loadUCFactory } from '@entifix/business';
import { formattingLocale } from '@entifix/core';
import { LocaleLink } from '@entifix/next-shell';
import {
  SummaryTile,
  useLocale,
  useRecordLabel,
  useTranslateKey,
} from '@entifix/react-controls';
import { entityQueryScope, useDataLoading } from '@entifix/react-integration';
import { ProductOrder } from '@r10c/business-ts-order-management';

import { PRODUCT_ORDER_SURFACE } from '../order-surfaces';
import { useOrderAdapters } from './order-context';

/** How many orders the tile lists: the latest few, never a second order list. */
export const LATEST_ORDERS = 5;

/**
 * When an order was placed, if it says. A list read over REST hands the member
 * back as the wire's ISO string rather than a `Date`, and formatting either
 * one that is not a real instant throws, so it is parsed and checked here.
 */
export const placedOn = (order: ProductOrder): Date | undefined => {
  const raw: unknown = order.placedAt;
  if (raw === undefined || raw === null) return undefined;
  const placed = new Date(raw as string | Date);
  return Number.isNaN(placed.getTime()) ? undefined : placed;
};

/**
 * The vendor home's orders tile (#563, ADR 0077): the latest orders, each one
 * activation from its own record, and the heading one from the order list.
 *
 * A short list rather than a count, because "how many orders" is not what a
 * vendor acts on; which ones came in is. Read through this shell's own adapter
 * under the order's query scope, so a pushed `product-order.*` refreshes it
 * like the list. An order is named by entifix's fallback, noun and short id,
 * until it is numbered (#577).
 */
export function LatestOrdersTile() {
  const translateKey = useTranslateKey();
  const nameOf = useRecordLabel();
  const locale = useLocale();
  const { productOrderRest } = useOrderAdapters();
  const { isLoading, items, error, refetch } = useDataLoading<
    ProductOrder,
    EntityRepositoryTag
  >({
    uc: loadUCFactory<ProductOrder>(),
    ctx: productOrderRest,
    initialPageSize: LATEST_ORDERS,
    initialSorting: { 0: { property: 'placedAt', type: 'desc' } },
    queryKey: [...entityQueryScope(ProductOrder), 'latest'],
  });
  const day = new Intl.DateTimeFormat(formattingLocale(locale), {
    dateStyle: 'medium',
  });

  return (
    <SummaryTile
      label={translateKey('r10c:order.home.latest')}
      href={PRODUCT_ORDER_SURFACE.basePath}
      state={error === undefined ? (isLoading ? 'loading' : 'ready') : 'failed'}
      onRetry={refetch}
      items={items.map(order => {
        const placed = placedOn(order);
        return {
          href: `${PRODUCT_ORDER_SURFACE.basePath}/${String(order.id)}`,
          label: nameOf(ProductOrder, order),
          ...(placed === undefined ? {} : { meta: day.format(placed) }),
        };
      })}
      emptyLabel={translateKey('r10c:order.home.none')}
      renderLink={({ href, className, children }) => (
        <LocaleLink href={href} className={className}>
          {children}
        </LocaleLink>
      )}
    />
  );
}
