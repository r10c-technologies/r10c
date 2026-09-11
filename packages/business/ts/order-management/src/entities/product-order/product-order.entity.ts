import type { Entity, EntityId } from '@r10c/entifix-ts-core';
import { accessor, entity } from '@r10c/entifix-ts-core';

import { OrderItem } from '../../values/order-item';
import { type OrderStatus, OrderStatuses } from '../../values/order-status';
import type { RelatedChannel } from '../../values/related-channel';

/**
 * A party's request for one or more offerings — one checkout, one receipt, even
 * when the basket spans several vendors.
 *
 * The multi-vendor case is carried on the **items**, not by splitting the order:
 * each {@link OrderItem} names its `vendorId`, so settlement aggregates per
 * vendor while the buyer sees the single order they actually placed
 * ([ADR 0022](../../../../../../docs/adr/0022-v1-marketplace-module-boundaries.md)).
 *
 * Platform plane, `order` store — readable by the buyer, the vendors on its
 * lines and the operator, and by no tenant handle. That is also why the
 * reservation each line holds is taken through a service-to-service crossing
 * rather than from the session: a buyer's session carries no organization, and
 * the vendor comes from the item
 * ([ADR 0023](../../../../../../docs/adr/0023-service-to-service-tenant-crossing.md)).
 *
 * The cart is **not** here. It is a cookie, so the storefront's first response is
 * correct without a round trip, and it becomes a `ProductOrder` only at checkout.
 *
 * **A storefront checkout is not the only way one of these is born.** A vendor
 * selling at their own counter produces this same entity with a different
 * {@link channel} — TM Forum models an in-store sale as a channel on the order
 * rather than a second kind of order, and following that is what keeps
 * settlement, returns and the buyer's history from splitting in two
 * ([ADR 0024](../../../../../../docs/adr/0024-selling-through-a-vendors-own-channel.md)).
 * The counter case is also why {@link buyerId} is optional.
 */
@entity({
  domain: 'order-management',
  key: 'product-order',
  labelKey: 'entity:product-order.label',
  pluralKey: 'entity:product-order.plural',
})
export class ProductOrder implements Entity {
  // #region properties
  #id?: EntityId;
  #buyerId?: string;
  #channel?: RelatedChannel;
  #status: OrderStatus = 'pending';
  #items: readonly OrderItem[] = [];
  #placedAt?: Date;
  #paidAt?: Date;
  #cancelDigest?: string;
  #cancelWindowEndsAt?: Date;
  // #endregion

  // #region constructors
  constructor(buyerId?: string) {
    this.#buyerId = buyerId;
  }
  // #endregion

  // #region accessors
  @accessor({ labelKey: 'entity:product-order.fields.id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  /**
   * The `Party` that placed it. Filterable — "my orders" is the buyer's page.
   *
   * **Optional, and that is a decision rather than laxity.** A walk-in buying at
   * a vendor's counter has no account, and demanding one at the register is
   * friction that gets worked around by inventing junk parties — which is worse
   * than an honest absence. {@link channel} is what explains the gap: an order
   * with no buyer came through a channel where anonymity is normal.
   *
   * The cost, stated so it is not rediscovered: a buyer's order list simply does
   * not match these, and attaching a party to a past counter sale — for a return
   * or a loyalty scheme — is a backfill, not a lookup
   * ([ADR 0024](../../../../../../docs/adr/0024-selling-through-a-vendors-own-channel.md)).
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:product-order.fields.buyerId',
    filterable: true,
  })
  get buyerId(): string | undefined {
    return this.#buyerId;
  }
  set buyerId(value: string | undefined) {
    this.#buyerId = value;
  }

  /**
   * Where the sale came from — the storefront, a vendor's counter, a phone line.
   *
   * TM Forum's answer to in-store selling, and the reason this class did not
   * need a sibling: TMF622 carries a `RelatedChannel` on the order rather than
   * forking by origin, so a counter sale is *this* entity with a different
   * channel. Building a separate in-store order would have split settlement,
   * returns and the buyer's history in two for no gain.
   *
   * A denormalized copy rather than a link, because a `SalesChannel` lives in
   * another slice's tenant store and this order is platform plane — see
   * {@link RelatedChannel}.
   *
   * Optional: orders captured before channels existed have none, and the
   * storefront may leave it unset when there is only one place a sale could have
   * come from. Absent is read as the storefront.
   *
   * Not filterable, for the same reason {@link items} is not — member metadata
   * is the server-side allowlist, and an embedded object compared as a scalar
   * matches nothing. Selecting orders by channel needs an index on the embedded
   * path.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:product-order.fields.channel',
    sortable: false,
    filterable: false,
  })
  get channel(): RelatedChannel | undefined {
    return this.#channel;
  }
  set channel(value: RelatedChannel | undefined) {
    this.#channel = value;
  }

  @accessor({
    type: 'enum',
    labelKey: 'entity:product-order.fields.status',
    enumValues: OrderStatuses,
    enumLabelKey: 'entity:product-order.values.status',
    required: true,
    filterable: true,
  })
  get status(): OrderStatus {
    return this.#status;
  }
  set status(value: OrderStatus) {
    this.#status = value;
  }

  /**
   * The lines. A **`composition`**: they are owned by this order, have no life
   * outside it, and go out in the same write
   * ([ADR 0034](../../../../../../docs/adr/0034-composition-metadata.md)).
   *
   * Not a `linkCollection`, which is association — targets that exist on their
   * own, are picked from existing records and save separately. An order line is
   * never picked and never outlives its receipt.
   *
   * `childType` is what a detail grid reads its columns from: `OrderItem`'s own
   * `@accessor()` metadata. A thunk, so the two modules' evaluation order stays
   * irrelevant.
   *
   * Sorting and filtering are off by construction — `describeEntityColumns`
   * defaults every collection to unqueryable and **throws** on a declaration
   * that says otherwise — because member metadata is the server-side query
   * allowlist and an embedded array compared as a scalar matches nothing.
   *
   * `hidden` would be the wrong tool here: it drops a member from serialization
   * *and* deserialization, so the lines would never persist.
   *
   * Vendor-scoped queries therefore need an index on the embedded path or a
   * projection — the accepted cost of one receipt per checkout.
   */
  @accessor({
    type: 'composition',
    childType: () => OrderItem,
    labelKey: 'entity:product-order.fields.items',
  })
  get items(): readonly OrderItem[] {
    return this.#items;
  }
  set items(value: readonly OrderItem[]) {
    this.#items = value;
  }

  @accessor({
    type: 'date',
    labelKey: 'entity:product-order.fields.placedAt',
    sortable: true,
    filterable: true,
  })
  get placedAt(): Date | undefined {
    return this.#placedAt;
  }
  set placedAt(value: Date | undefined) {
    this.#placedAt = value;
  }

  /**
   * When the capture that paid for this order was decided.
   *
   * ⚠️ **Server-owned, and writable anyway.** The payment projection sets it
   * from `payment.captured`'s own `decidedAt` in the same conditional update
   * that moves `status` to `paid`, and no route accepts it from a caller.
   * Declaring it `readonly` would drop it from **deserialization** as well as
   * serialization, so the value would never reach a screen either — the same
   * trap a read-only audit stamp always is.
   *
   * It existed in Mongo before it existed here: the projection wrote the field
   * and this entity declared no accessor for it, so it reached no envelope, no
   * column and no form (#249). A member without a getter is invisible to every
   * adapter, which is why the write looked correct and changed nothing anybody
   * could see.
   *
   * Sortable and filterable because "what did we take money for this week" is
   * the question a vendor's statement is reconciled against, and member
   * metadata is the server-side query allowlist.
   */
  @accessor({
    type: 'date',
    labelKey: 'entity:product-order.fields.paidAt',
    sortable: true,
    filterable: true,
  })
  get paidAt(): Date | undefined {
    return this.#paidAt;
  }
  set paidAt(value: Date | undefined) {
    this.#paidAt = value;
  }

  /**
   * The SHA-256 digest of the nonce that authorizes the buyer's own cancel.
   *
   * ⚠️ **The digest, never the nonce.** The storefront mints 256 bits of
   * randomness per checkout, keeps it in the buyer's `httpOnly` receipt cookie,
   * and sends only this digest into the order. That is what lets an anonymous
   * buyer be authorized for a write with nothing stored anywhere that can
   * perform it ([ADR 0058](../../../../../../docs/adr/0058-the-order-after-payment.md)).
   *
   * ⚠️ **Why it is not the signed token the obvious design reaches for.** An
   * order is written *inside* the checkout saga, so anything the `201` carries
   * becomes the step's outcome — persisted in the `saga` store and served whole
   * by `GET /api/saga/:id` to any principal whose organization appears among the
   * flow's calls, which is every vendor in the basket. A bearer token there
   * would let one vendor cancel a multi-vendor order their own session is
   * refused with `409`. A digest carries no such authority: it is serialized
   * here in the open precisely because inverting it is the problem SHA-256 is.
   *
   * ⚠️ **Absent is a meaningful value.** A counter sale carries no digest,
   * because at a till there is no browser to hold the nonce and no buyer's
   * cancel to authorize. Clearing it is also how a cancel window is revoked.
   *
   * ⚠️ **Not `@accessor({ hidden })`, however much a machine-valued member
   * wants to be.** That flag drops the member from **deserialization** as well
   * as from serialization — the same trap `readonly` is, which `paidAt`
   * documents a few lines up — so a hidden digest would never arrive off the
   * wire and the member would sit permanently empty. Hiding the input is a
   * screen's job, and the screen is `<EntityField … hidden />`.
   *
   * ⚠️ **`filterable` and `sortable` are written `false`, not omitted.**
   * `describeEntityColumns` defaults both to **true** for a scalar, so leaving
   * them out is how a member becomes queryable by accident — and member metadata
   * is the server-side allowlist, so a queryable digest lets a caller confirm a
   * guess one request at a time, and a sortable one leaks their order. Omission
   * is not denial here.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:product-order.fields.cancelDigest',
    sortable: false,
    filterable: false,
  })
  get cancelDigest(): string | undefined {
    return this.#cancelDigest;
  }
  set cancelDigest(value: string | undefined) {
    this.#cancelDigest = value;
  }

  /**
   * When the buyer's own cancel stops being possible.
   *
   * ⚠️ **Server-owned, stamped at placement from the order's own `placedAt`.**
   * It is a stored timestamp rather than an expiry claim inside a token for two
   * reasons: order-service can shorten or revoke it after the fact, and there is
   * no key whose rotation silently ends every live window at once.
   *
   * It must match the receipt cookie's own lifetime. The cookie is the only
   * place the nonce lives, so a window wider than the cookie is a capability
   * nobody can present, and a cookie longer than the window is a Cancel button
   * that quietly stops working.
   */
  @accessor({
    type: 'date',
    labelKey: 'entity:product-order.fields.cancelWindowEndsAt',
    sortable: true,
    filterable: true,
  })
  get cancelWindowEndsAt(): Date | undefined {
    return this.#cancelWindowEndsAt;
  }
  set cancelWindowEndsAt(value: Date | undefined) {
    this.#cancelWindowEndsAt = value;
  }
  // #endregion
}
