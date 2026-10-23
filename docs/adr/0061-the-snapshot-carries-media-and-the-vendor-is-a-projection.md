# 61. The snapshot carries media references, and the vendor's name is a projection

- Status: Accepted
- Date: 2026-10-23
- Area: business
- Read when: rendering a product image or a seller's name on the storefront, or adding vendor data the storefront needs — media is a reference the vendor authored, never bytes we store, and a vendor's name reaches the platform plane as its own projection, never copied into an offering's snapshot
- Amends: [ADR 0049](0049-the-publication-snapshot-carries-what-the-storefront-renders.md) — the snapshot gains an optional `media` member.
- Amends: [ADR 0022](0022-v1-marketplace-module-boundaries.md) — one domain (`marketplace-vendor`), one entity (`PublishedVendor`) and one store (`published-vendor`) join the inventory; slices and deployments are unchanged.

## Context

M10's storefront is a search-and-browse store: a card with a picture, a product
page with a gallery, a seller line and a seller facet
([#325](https://github.com/r10c-technologies/r10c/issues/325)). Measured on
2026-10-23:

- **No media exists anywhere.** `ProductSpecification` carries `code`, `name`,
  `description`, `brandId` and `categoryId`. `PublishedOffering` mirrors the
  snapshot ADR 0049 defined, and neither has an image. ADR 0009 already said
  the projection copies "media references"; nothing had carried one yet.
- **The vendor has an id and no name.** The snapshot carries `vendorId`, which
  is the publishing session's `organizationId`. The name is
  `Organization.name`, in the control-plane `auth` store, written by
  auth-service.
- **Nothing outside auth-service can read it.** marketplace-admin-service,
  which emits the publication, has no handle on the `auth` database and no
  client to auth-service. A slice reading another slice's collections is the
  first coupling `planes.md` forbids.
- **Unit price needs a vocabulary.** "Q 12.50 / kg" needs a net quantity and a
  unit, and units belong to ADR 0014's characteristic dictionary, which is
  Proposed and unbuilt.

## Decision

### Media is a reference the vendor authored

`ProductSpecification` gains `media?: { url, alt }[]`, and the snapshot carries
it to `PublishedOffering` unchanged.

- **The bytes stay where the vendor put them.** A URL is all that is stored.
  r10c hosting uploads would add a store for blobs, a write path for them, a
  size and type policy, and a decision about which slice owns them. None of
  that is needed to render a picture, and every one of them is reversible
  later: a hosted upload produces a URL too.
- **`https` only, checked when the specification is saved.** The storefront
  renders the URL into a page served over `https`. Mixed content is blocked by
  the browser, and a `javascript:` or `data:` value in an `src` is a hole, so
  the check lives at the one write path rather than at every reader.
- **`alt` is required on every entry.** An image without a text alternative is
  an accessibility defect, and the vendor is the only party who knows what the
  picture shows.
- **Order is the vendor's.** The first entry is the card image and the gallery
  follows the array. No `primary` flag: a flag can be set on two entries, and
  an order cannot.

It follows ADR 0049's rules for a new member. It is **optional**, because a
required member a source legitimately lacks makes the offering permanently
unannounceable. And it is **written absent rather than `undefined`**, because the
outbox round trip turns `undefined` into BSON `null`. An empty array is written
absent too, for the reason `''` is: an empty gallery is a slot that claims to
hold something.

### The vendor's name is a projection, not a copy

The snapshot keeps carrying `vendorId` and only `vendorId`, for exactly the
reason ADR 0049 gave for brand and category names. A copied name freezes into
every published record until each one is republished, and nothing walks them.
A renamed vendor would show its old name on every listing it already has.

Instead:

1. **auth-service announces organizations.** It gains a Mongo outbox in the
   `auth` store and an AMQP connection, and every write of an `Organization`
   emits `organization.announced { organizationId, displayName, announcedAt }`
   in the same transaction (ADR 0028's outbox).
2. **marketplace-service projects them** into a new platform-plane store,
   `published-vendor`. It holds one `PublishedVendor { vendorId, displayName }`
   per organization, ordered on `announcedAt` exactly as ADR 0048 orders a
   publication on `publishedAt`, so a redelivered older announcement cannot
   overwrite a newer name.
3. **The storefront resolves the name the way it resolves a brand's.** It
   reads the vocabulary, finds the vendor by id, and renders no seller line
   when the lookup misses. An absent seller line is honest; a raw id is not.

### Why a store of its own

`published-catalog` is `projection-of:catalog`, and a store carries exactly one
`truth`. That is why `catalog-reference` and `published-catalog` are two stores
(the marketplace slice's own declaration says so). A vendor's name comes from
`auth`, not from `catalog`. So it is a second projection store, owned by the
same slice, hosting a new domain named the way `marketplace-catalog` is: the
marketplace's published copy of something another domain owns.

| Store              | Plane    | Owner slice   | Hosts                | Truth                |
| ------------------ | -------- | ------------- | -------------------- | -------------------- |
| `published-vendor` | platform | `marketplace` | `marketplace-vendor` | `projection-of:auth` |

The plane is platform because anonymous storefront traffic reads it. That
says nothing about the `auth` store it comes from. A display name is published
by definition; the membership, roles and entitlements beside it in `auth` are
not, and none of them is announced.

### A fresh lab has names without anyone renaming anything

**Today the only writer of an `Organization` is auth-service's seed.** There is
no rename route, and provisioning (ADR 0011) is unbuilt. So the announcement
fires when the seed writes its rows, and a **rebuild walk** in the style of
ADR 0050 re-announces every organization from the `auth` store on demand.
Like that walk it must never stamp `now`: it announces each organization at the
timestamp of its own last write, so a rebuild cannot outrank a real rename that
arrived while it ran.

The first route that writes an organization, whether provisioning or a rename,
emits the same event through the same outbox. That is its acceptance, not a
change to this record.

### Unit price is out of M10

It needs a net quantity and a unit from ADR 0014's dictionary, and inventing a
unit list here would be the second vocabulary that ADR 0014 exists to prevent.
The card keeps an absent `unitPrice` role until that dictionary is built.

## Consequences

- auth-service is no longer the one slice with a store and no bus connection
  on the identity side. Its outbox and its AMQP binding are declared in its
  slice and served in `/api/$service` (ADR 0031), so the register and the
  running service can be diffed.
- The inventory grows by one domain, one entity and one store. Slices and
  deployments are unchanged, because the new store belongs to the marketplace
  slice, which already deploys.
- Media is untrusted input rendered on a public page. The `https` check at save
  is the security boundary, and a reader must not relax it by accepting a
  relative or protocol-less URL.

## What this does not build

Hosted uploads, image resizing or a CDN · unit price · a vendor profile page ·
organization rename or provisioning routes. The last one is ADR 0011's, and it
inherits the announcement rather than redesigning it.
