/**
 * **payment-contracts** — the wire contract for a payment outcome.
 *
 * `business:policy`, not `business:domain`, and that tag is the whole reason
 * this package exists. `payment-management` decides an outcome, and
 * `order-management` and `settlement-management` both read it — a
 * `business:domain` package may never depend on another, which makes sharing the
 * payload's shape through any of them an illegal edge the build rejects.
 *
 * The same seam `catalog-contracts` opened for `catalog.published`, and opened
 * again here for the reason that record gives: nothing can compare two
 * hand-written copies of a structure, and a member added on one side only is a
 * field the consumer silently never reads.
 *
 * The constraint that keeps `business:policy` honest is unchanged and enforced:
 * it may depend only on `layer:entifix` and `layer:utils`, so nothing here can
 * reach an entity, a use case or a repository. See
 * [ADR 0054](../../../../docs/adr/0054-capture-is-the-pivot-and-the-bus-carries-what-follows.md).
 */
export * from './values';
