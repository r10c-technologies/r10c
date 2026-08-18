import type { Entity, EntityId } from '@r10c/entifix-ts-core';
import { accessor, entity } from '@r10c/entifix-ts-core';

import {
  type SalesChannelStatus,
  SalesChannelStatuses,
} from '../../values/sales-channel-status';
import {
  type SalesChannelType,
  SalesChannelTypes,
} from '../../values/sales-channel-type';

/**
 * A route a vendor sells through — the storefront, a counter in their own shop,
 * a phone line.
 *
 * SID's name, from the Sales Channel ABE in the Market/Sales domain. It exists
 * because the platform had exactly one implicit channel and no way to say so:
 * every order was a storefront checkout, so "where did this sale come from?"
 * had no member to answer with, and a vendor selling in their own shop had
 * nowhere to record it
 * ([ADR 0024](../../../../../../docs/adr/0024-selling-through-a-vendors-own-channel.md)).
 *
 * **Tenant plane**, `sales` store. A channel is per-vendor, and the contrast
 * with `catalog-reference` is the whole reason: brand and category are platform
 * plane because a marketplace has to *merge* them — two vendors' private
 * "Electronics" can never become one browse tree. Channels never merge. One
 * vendor's counter means nothing to another, so there is nothing to reconcile
 * and no reason to leave the tenant boundary.
 *
 * Its own store rather than a corner of `catalog`, because two domains sharing a
 * store is a **binding** — permanently co-deployed, undone only by a data
 * migration ([ADR 0020](../../../../../../docs/adr/0020-stores-and-slices.md)).
 * A vendor's channel configuration and their product catalog have no reason to
 * be welded together, and `auth` should stay the only multi-domain store here.
 *
 * A `ProductOrder` references a channel by a **denormalized copy**, never a
 * link: the order lives in the platform plane and cannot dereference a tenant
 * pointer, which is the same constraint that makes `PublishedOffering` copy
 * price and vendor rather than pointing at them.
 */
@entity({
  domain: 'sales-management',
  key: 'sales-channel',
  labelKey: 'entity:sales-channel.label',
  pluralKey: 'entity:sales-channel.plural',
})
export class SalesChannel implements Entity {
  // #region properties
  #id?: EntityId;
  #name: string;
  #type: SalesChannelType;
  #status: SalesChannelStatus = 'active';
  // #endregion

  // #region constructors
  constructor(name = '', type: SalesChannelType = 'counter') {
    this.#name = name;
    this.#type = type;
  }
  // #endregion

  // #region accessors
  @accessor({ labelKey: 'entity:sales-channel.fields.id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  /**
   * What the vendor calls it — "Tienda Centro", "Mostrador 2".
   *
   * `filterable` is declared rather than inherited, and it is load-bearing: the
   * selling screen picks a channel by name through a `like` query, and member
   * metadata is simultaneously the server-side RSQL allowlist. Losing the flag
   * fails silently at both ends — the service answers `400`, the picker renders
   * that as an empty suggestion list reading as "there are no channels" — which
   * is why `useEntityLinkSource` asserts it rather than trusting it.
   */
  @accessor({
    type: 'string',
    labelKey: 'entity:sales-channel.fields.name',
    required: true,
    filterable: true,
  })
  get name(): string {
    return this.#name;
  }
  set name(value: string) {
    this.#name = value;
  }

  /**
   * Filterable because settlement reads it: an `Agreement` carries a commission
   * rate per channel type, so folding a payout means selecting the lines that
   * came through each one.
   */
  @accessor({
    type: 'enum',
    labelKey: 'entity:sales-channel.fields.type',
    enumValues: SalesChannelTypes,
    enumLabelKey: 'entity:sales-channel.values.type',
    required: true,
    filterable: true,
  })
  get type(): SalesChannelType {
    return this.#type;
  }
  set type(value: SalesChannelType) {
    this.#type = value;
  }

  @accessor({
    type: 'enum',
    labelKey: 'entity:sales-channel.fields.status',
    enumValues: SalesChannelStatuses,
    enumLabelKey: 'entity:sales-channel.values.status',
    required: true,
    filterable: true,
  })
  get status(): SalesChannelStatus {
    return this.#status;
  }
  set status(value: SalesChannelStatus) {
    this.#status = value;
  }
  // #endregion
}
