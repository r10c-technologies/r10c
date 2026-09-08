/**
 * **catalog-contracts** — the wire contract for a catalog publication.
 *
 * `business:policy`, not `business:domain`, and that tag is the whole reason
 * this package exists. `product-configuration-management` authors an offering
 * and `marketplace-catalog` projects it, so both need the payload's shape — and
 * a `business:domain` package may never depend on another, which makes sharing
 * the type through either domain an illegal edge the build rejects.
 *
 * The repository predicted this package before it was needed:
 * `settlement-management`'s duplicated channel literals carry a comment saying
 * "the real fix — if this ever bites — is a shared `business:policy` vocabulary
 * package, not a dependency edge"
 * ([ADR 0024](../../../../docs/adr/0024-selling-through-a-vendors-own-channel.md)).
 * Four copied strings did not bite; a seven-member payload with a decoder does,
 * because nothing can compare two hand-written copies of a structure and a
 * member added on one side only is a field the projection silently never
 * writes.
 *
 * So `business:policy` now means "shared vocabulary a domain may express itself
 * in" rather than "shared *authorization* vocabulary". The constraint that keeps
 * it honest is unchanged and is enforced: it may depend only on `layer:entifix`
 * and `layer:utils`, so nothing here can reach an entity, a use case or a
 * repository. See
 * [ADR 0048](../../../../docs/adr/0048-announcing-a-publication.md).
 */
export * from './values';
