'use client';

import type { EntityCrud } from '@entifix/next-shell';
import { makeEntityCrud } from '@entifix/next-shell';
import { ProductOrder } from '@r10c/business-ts-order-management';

import { PRODUCT_ORDER_SURFACE } from '../order-surfaces';
import { useOrderAdapters } from './order-context';

export const productOrderCrud: EntityCrud<ProductOrder> = makeEntityCrud(
  ProductOrder,
  {
    useAdapters: useOrderAdapters,
    basePath: PRODUCT_ORDER_SURFACE.basePath,
    catalogKey: PRODUCT_ORDER_SURFACE.entityKey,
    repository: 'productOrderRest',
    // Server-owned: `place-order.ts` assigns it with `randomUUID()`, so a field
    // asking for one would be asking for a value the service overwrites.
    //
    // `cancelDigest` is server-carried rather than server-written, and hiding it
    // is a screen's job: `@accessor({ hidden })` would drop it from
    // deserialization too, so the member would sit permanently empty and no
    // buyer's capability would ever arrive
    // ([ADR 0058](../../../../../../docs/adr/0058-the-order-after-payment.md)).
    //
    // ⚠️ `items` is deliberately **not** hidden. `hidden` drops a member from
    // serialization *and* deserialization, so hiding the lines would mean an
    // order rendered without the only thing on it that says what was bought.
    // They are read-only because the descriptor withholds Save, which is the
    // right mechanism — a receipt is not a form.
    hiddenFields: ['id', 'cancelDigest'],
    // ⚠️ **Both, or the verbs render nowhere.** `EntityForm` computes its header
    // actions as `onUseCase ? declared : []`, so a metadata source with no
    // handler draws a declared, granted, served verb as nothing at all — and a
    // handler with no metadata source has nothing to draw. `catalog-crud.tsx`
    // carries the same note over the same pair.
    metadata: 'metadata',
    useCases: 'productOrderUseCases',
  },
);

/**
 * Every generated order screen, for the host's workspace registry to derive its
 * `operation:` tabs from — the same list the nav and the search sources come
 * from, so a second entity is one `OrderSurface` and one `makeEntityCrud` call.
 */
export const ORDER_CRUDS = [productOrderCrud] as const;

export const ProductOrderListClientPage = productOrderCrud.ListPage;
export const ProductOrderSingleViewClientPage = productOrderCrud.SingleViewPage;
