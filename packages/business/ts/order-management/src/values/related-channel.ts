/**
 * The channel a sale came through, copied onto the order.
 *
 * TMF622's name. It is a **denormalized copy**, not a reference, and both halves
 * of that are deliberate.
 *
 * Not a `link`: a `SalesChannel` lives in the tenant-plane `sales` store owned
 * by another slice, so a typed link would be both an illegal import and the
 * storage-layer join `_shared/planes.md` forbids. A cross-store reference is an
 * id.
 *
 * But not a bare id either. A `ProductOrder` is platform plane, and a
 * platform-plane reader — the buyer looking at their receipt, the operator
 * reading a report — cannot dereference a tenant pointer at all. So the name and
 * type travel with the order, exactly as `PublishedOffering` copies price and
 * vendor rather than pointing at them. The id is kept alongside so the vendor,
 * who *can* resolve it, still reaches the live record.
 *
 * The copy is taken at capture and never refreshed. Renaming a channel does not
 * rewrite history, which is the intended behaviour for a receipt.
 *
 * `type` is a plain string rather than `SalesChannelType`: this package may not
 * import `sales-management` (`business:domain` never depends on another
 * `business:domain`), and the closed set lives there.
 */
export interface RelatedChannel {
  /** The `SalesChannel` id, resolvable only inside the owning vendor's tenant. */
  readonly id: string;
  /** Copied at capture, so a platform-plane reader needs no tenant handle. */
  readonly name: string;
  /** A `SalesChannelType` value. Settlement prices a line by this. */
  readonly type: string;
}
