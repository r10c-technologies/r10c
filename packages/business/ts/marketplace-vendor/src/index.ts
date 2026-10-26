/**
 * **marketplace-vendor** — platform plane, `published-vendor` store.
 *
 * The marketplace's published copy of what a buyer may know about a seller:
 * its display name, and nothing else. Named the way `marketplace-catalog` is —
 * the marketplace's published view of something another domain owns — because
 * the source is `party-management`'s `Organization`, in the control-plane
 * `auth` store, which no storefront read may open
 * ([ADR 0061](../../../../docs/adr/0061-the-snapshot-carries-media-and-the-vendor-is-a-projection.md)).
 *
 * A store of its own rather than a collection in `published-catalog`, because a
 * store carries exactly one `truth`: that one is `projection-of:catalog`, and
 * this one is `projection-of:auth`.
 */
export * from './domain';
export * from './entities/published-vendor';
export * from './ports';
