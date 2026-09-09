'use client';

import { ProductOrder } from '@r10c/business-ts-order-management';
import { makeEntityMetadataSource } from '@r10c/entifix-ts-rest-client';
import type { EntityCrud } from '@r10c/shells-next-common';
import { makeEntityCrud } from '@r10c/shells-next-common';

import { PRODUCT_ORDER_SURFACE } from '../order-surfaces';
import { useOrderAdapters } from './order-context';

/**
 * The served affordance document, through the host's same-origin proxy.
 *
 * ⚠️ It is what decides whether this screen shows a Save at all. No role holds
 * `order-management:product-order:write`, so `$metadata` withholds the verb and
 * the form renders read-only — without this shell asserting anything about it
 * ([ADR 0026](../../../../../../docs/adr/0026-the-use-case-descriptor-and-served-entity-metadata.md)).
 */
const ORDER_METADATA = makeEntityMetadataSource({
  url: name => `/api/order/${name}/$metadata`,
});

export const productOrderCrud: EntityCrud<ProductOrder> = makeEntityCrud(
  ProductOrder,
  {
    useAdapters: useOrderAdapters,
    basePath: PRODUCT_ORDER_SURFACE.basePath,
    catalogKey: PRODUCT_ORDER_SURFACE.entityKey,
    repository: 'productOrderRest',
    configuration: 'configurationStore',
    // Server-owned: `place-order.ts` assigns it with `randomUUID()`, so a field
    // asking for one would be asking for a value the service overwrites.
    //
    // ⚠️ `items` is deliberately **not** hidden. `hidden` drops a member from
    // serialization *and* deserialization, so hiding the lines would mean an
    // order rendered without the only thing on it that says what was bought.
    // They are read-only because the descriptor withholds Save, which is the
    // right mechanism — a receipt is not a form.
    hiddenFields: ['id'],
    metadataSource: ORDER_METADATA,
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
