/**
 * **party-contracts** — the wire contract for an organization's announcement.
 *
 * `business:policy`, for the reason `catalog-contracts` is: `party-management`
 * owns the `Organization` and `marketplace-vendor` projects its name, and a
 * `business:domain` package may not depend on another, so the shape both sides
 * read has to sit where both can reach it
 * ([ADR 0061](../../../../docs/adr/0061-the-snapshot-carries-media-and-the-vendor-is-a-projection.md)).
 *
 * It carries the display name and nothing else. The membership, roles and
 * entitlements beside the organization in the `auth` store are not published,
 * and nothing here could describe them.
 */
export * from './values';
