'use client';

import { ProductOrder } from '@r10c/business-ts-order-management';
import { EntifixLogicError, type EntityId } from '@r10c/entifix-ts-core';
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
 *
 * It is also what decides whether `fulfil` and `cancel` appear: the document is
 * filtered by the caller's real grants, so a `user` sees neither and no
 * client-side check is needed or wanted.
 */
const ORDER_METADATA = makeEntityMetadataSource({
  url: name => `/api/order/${name}/$metadata`,
});

/**
 * Runs an `entity`-bound verb on one order.
 *
 * ⚠️ **The verb key *is* the route segment** — `fulfil` posts to
 * `…/<id>/fulfil` — which holds only while the two agree, and nothing asserts
 * it. That is the convention `runCatalogUseCase` already follows for publish,
 * and this is the honest place for a map if a verb ever needs one.
 *
 * ⚠️ `cancel` posts to `…/<id>/cancellation`, which is the one place the two
 * diverge. The service serves `/cancelling` as well and it is a *different*
 * route: that one is the saga's claim step behind a crossing token, and a
 * browser reaching it would be starting half a flow with no refund after it.
 *
 * A failed request **throws**, so the form's error slot renders it: a `409`
 * carries a `code` the shared `errors` catalog resolves, and swallowing it
 * would leave the vendor looking at a button that did nothing.
 */
const ROUTE_FOR: Readonly<Record<string, string>> = { cancel: 'cancellation' };

export const runOrderUseCase = async (key: string, id: EntityId) => {
  // `String(id)`: `EntityId` admits a symbol, which interpolates to a runtime
  // throw rather than a compile error in a template literal.
  const response = await fetch(
    `/api/order/product-order/${String(id)}/${ROUTE_FOR[key] ?? key}`,
    { method: 'POST', headers: { 'content-type': 'application/json' } },
  );

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      code?: string;
      error?: string;
    };
    // An `EntifixError` carrying the service's `code` in `details`, because that
    // is exactly what `useErrorMessage` resolves through the shared `errors`
    // catalog — a bare `Error` would render its own message, which is an English
    // sentence nobody wrote for a user to read.
    throw new EntifixLogicError(body.error ?? `${key} failed`, undefined, {
      code: body.code ?? 'unexpected',
    });
  }
};

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
    metadataSource: ORDER_METADATA,
    runUseCase: runOrderUseCase,
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
