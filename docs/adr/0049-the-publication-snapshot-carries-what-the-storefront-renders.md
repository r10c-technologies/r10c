# 49. The publication snapshot carries what the storefront renders

- Status: Accepted
- Date: 2026-09-08
- Amends: [ADR 0048](0048-announcing-a-publication.md) — the announced payload is
  eleven members, not seven, and a publication now has a second precondition.

## Context

M1's chain is: author a `ProductOffering` → move it to `published` → emit
`catalog.published` → consume it and write the projection → the storefront reads
real data → delete the fixture. ADR 0047 built the first two links and ADR 0048
the next two. The projection fills.

It does not fill with enough to render a store, which is what
[#214](https://github.com/r10c-technologies/r10c/issues/214) is.

### Measured

`CatalogPublication` carried seven members — `offeringId`, `vendorId`, `name`,
`amount`, `currency`, `availableHint`, `publishedAt` — and `PublishedOffering`
mirrored them exactly. What the storefront reads off a specification today, in
`packages/shells/next/marketplace/src/lib/catalog/`:

| Rendered as | Member | On the snapshot |
| --- | --- | --- |
| the product path | `code` | ❌ |
| the card's body and the detail page's blurb | `description` | ❌ |
| the card's and the page's brand line | `brandId` | ❌ |
| `/c/<category>` and the related-products strip | `categoryId` | ❌ |

`ProductOffering` carries only `id`, `name`, `specificationId` and `status`;
every merchandising field lives on the **pinned `ProductSpecification`**, which
is tenant-plane. The storefront may never read it — that is the plane split, not
a permission — so this cannot be solved on the storefront side at all. ADR 0009
already answered it in principle: the projection copies price, currency, terms,
vendor identity, **title and media references**. The payload had simply not
carried the second half yet.

## Decision

### The snapshot carries ids, never the brand's or the category's name

`brandId` and `categoryId` go across; the names do not.

`catalog-reference` is platform plane **precisely because a marketplace has to
merge a browse tree** — per-vendor taxonomy cannot (ADR 0022). marketplace-
service owns that store and already serves it, so the storefront resolves a name
through that domain's own read path: the same host, one more read on a page it
prerenders per locale.

Copying the names instead would freeze a renamed brand into every projected
record until each offering was republished — and nothing walks them, because the
fleet-wide rebuild is still owed
([#215](https://github.com/r10c-technologies/r10c/issues/215)). A denormalized
copy of the one vocabulary the platform exists to keep coherent is the shape
that makes it incoherent.

This is not in tension with "a published record is a snapshot, not a reference".
The rule protects a buyer from a price edited mid-session and a platform reader
from dereferencing a **tenant** pointer. A brand id points at the same plane, at
a store this very slice owns, whose entire purpose is that everyone sees one
value for it.

### The four new members are optional, and that is a safety property

None of them may be required, and the reason is mechanical rather than stylistic.

`readCatalogPublication` rejecting a payload does not produce a retry: the
adapter classifies it **poison** and quarantines it with **zero** attempts
(ADR 0030), because a payload that cannot be deserialized never becomes
deserializable. So a required member the source may legitimately lack does not
degrade the offering — it makes it permanently unannounceable, with the only
evidence in another service's log.

The sources legitimately lack them. `description`, `brandId` and `categoryId`
are `string | undefined` on `ProductSpecification`. And `code` — which is
service-assigned from a Redis sequence and reads like an invariant — is blanked
by an ordinary edit: `product-specification.routes.ts` registers `PUT` as a
plain `saveRoute` with **no** `prepare` hook, so only `POST` runs
`makeCatalogTransactionHandler`, and a body omitting `code` deserializes to the
constructor's `''`. There is no `preserveSpecificationCode` analogue to
`preserveOfferingStatus`.

The second argument is about the widening itself. Every message already sitting
in a durable queue was written against the seven-member shape. Optional decoding
is what lets those drain normally instead of turning into poison the moment the
consumer is redeployed.

### ⚠️ An absent member is written as absent, never as `undefined`

`merchandisingOf` spreads only the members that have a value, and
`optionalString` folds absent, `null`, `''` and non-string alike to `undefined`
on the way back in. Both halves are needed, and the `null` arm is the
non-obvious one.

The event is written to the **outbox** before it is published.
`MongoClientLayer` does not set `ignoreUndefined`, so the driver's default
stores `undefined` as BSON `null`, and `outboxDocument` stores the whole event.
A member assigned `undefined` on the emitting side therefore reaches the
consumer's decoder as `null` after the round trip — and a reader that accepted
only `string | undefined` would quarantine a message this fleet produced itself.

Not writing it is the half that does not depend on the reader being careful;
tolerating `null` is the half that does not depend on every future emitter being
careful. Neither is redundant.

`''` folds with them: an empty reference renders as nothing while occupying a
label that claims to be one.

### The storefront address is the offering; `code` is a reference

`code` is drawn from a single Redis sequence and is therefore unique across the
marketplace — but uniqueness was never the problem. `ProductOffering` and
`ProductSpecification` are **1:N by construction**, which is why the two classes
exist, so two vendors offering the same product produce two offerings carrying
one `code`. A path built from it collides, and it collides in the worst
available way: a lookup by code returns the *first* match rather than failing, so
the second vendor's listing is silently unreachable instead of visibly broken.

`offeringId` is already the projection's natural key and already `filterable`.
`code` stays on the snapshot as the reference a buyer quotes back — the
storefront already labels it "Referencia" — and the URL is not built from it.
Building that URL is #147's; deciding what the payload can support is this
record's.

### Publishing requires a specification; taking down does not

`specificationId` is a plain id and nothing enforces it, so deleting a
specification leaves its offerings behind. Publishing one anyway projects a
record with a name and a price and nothing else — a card that reads to the vendor
as a rendering fault rather than as data they own. So `publish` answers
**`409 offeringHasNoSpecification`**, carrying the dangling id, because the
offering's own screen cannot show it.

⚠️ **It is ordered before the price check.** An offering naming nothing describes
no product at all; sending its vendor to add a price points them at the wrong
screen entirely.

⚠️ **And it refuses a publication only, never a takedown.** The lookup runs on
both transitions, because the announced payload must not change shape by event
name — but refusing an *unpublish* because the record it describes is broken
leaves a vendor unable to remove a live listing, with repairing tenant data as
the only remedy.

That is a deliberate divergence from the price precondition beside it. ADR 0048
accepted exactly this residual ("an offering whose only price is deleted cannot
be unpublished through this path") and recorded it as a cost. A second
precondition with the same shape would compound it, and takedown is the operation
where being stuck is least acceptable — an offering someone wants gone is more
urgent than one they want up.

### The specification is read with `load`, not `get`

`makeMongoRepository`'s `get` fails an absent row with **`EntifixConnError`** —
the same class it raises when the driver itself fails, and core declares no
`EntifixNotFoundError`. The two are separable only by matching a message string,
which is not a contract.

So mapping `get`'s failure to `OfferingHasNoSpecification` would answer
`409 offeringHasNoSpecification` to every vendor in the fleet during a Mongo
outage: a green service telling everyone their data is broken. `load` with a
one-row filter makes absence `items[0] === undefined` and leaves a real failure
in the error channel, where `Effect.catchAll(serverError)` answers `500`. It is
also the shape the price lookup beside it already uses.

Two notes on why this is safe. The repository applies no `filterable` allowlist —
that gate is `coerce-rsql.ts`, at the HTTP layer — so filtering on `id`
in-process is legal even though `id` is not a filterable column. And a third
`Context.Tag` rather than a third use of `EntityRepositoryTag`, for the reason
the price tag already states: one tag resolves to one value, so the last
provision would answer every read and a repository built for `ProductOffering`
would deserialize a specification into the wrong class rather than failing.

### The projector writes through `serializeEntity`

The upsert used to be a hand-written object literal naming all eight members —
a second declaration site the payload/entity parity spec could not see. Adding a
member to the snapshot and forgetting it there is not an error: it is a field
that silently never reaches the storefront, which reads as data that never
arrived.

`serializeEntity(PublishedOffering, projected)` walks the accessors, keys the
document by `alias ?? name` — the same keys `makeMongoRepository` reads back —
and omits `undefined` rather than storing `null`.

It can still hide one thing: it skips accessors marked `hidden` or `readonly`,
so either flag on a snapshot member would stop projecting it with every test
green. `publish-catalog.spec.ts` now asserts the **written document** against the
payload's own members, not only that the entity has a home for each.

### The scan that was supposed to catch an uncataloged code was not watching

⚠️ Found while adding `offeringHasNoSpecification`, and it is an instance of the
fault [ADR 0046](0046-conventions-are-checked-not-stated.md) was written about.

`@r10c/i18n-check` matches two emission shapes: the `error: '…', code: '…'` body
pair, and a `CodedAuthnError` subclass's second argument. A `Data.TaggedError`
carries its code as a class member, and the route answers `code: failure.code` —
a member expression. Neither matcher sees it. So `illegalOfferingTransition` and
`offeringHasNoPrice` were emitted by a live route, cataloged by hand, and
invisible to the gate that exists to stop a raw code reaching a user. A new code
would have passed with no entry at all.

The matcher now resolves `readonly code = IDENTIFIER` against the file's own
`export const IDENTIFIER = '<literal>'`. Resolved **within the file**, not across
the module graph: every such class in this repository declares its code beside
itself, and following the identifier further would build a module graph this scan
deliberately does not have. `export`ed only, because a code a route can render is
one the domain published.

Measured: the scan went from 48 emissions across 12 files to 51 across 13, and
the three it gained are exactly the offering codes it had been missing.

## Consequences

- **The storefront can be written against the projection** — that is #147, and
  it is what this unblocks. Nothing in the storefront changes here.
- **A record projected before this carries none of the four.** Old documents
  deserialize fine (`required` is read only on the form path), so they render as
  cards with a name and a price. Republishing one converges it; the fleet-wide
  walk is still #215, and this widening is one more reason it is owed.
- ⚠️ **A vendor can still publish an offering whose specification lost its
  `code`.** The snapshot omits it, the storefront shows no reference, and nothing
  reports it. The real fix is a `preserveSpecificationCode` hook mirroring
  `preserveOfferingStatus`, so a `PUT` cannot blank a member the service owns;
  it is not folded in here because it belongs to the specification's write path
  rather than to the publication's read of it.
- ⚠️ **Publishing a *deleted* offering answers `500`, not `404`.**
  `transitionOffering` reads the offering itself with `repository.get`, which is
  the conflation this record avoided for the specification and did not fix for
  the offering. The clean answer is an `EntifixNotFoundError` in
  `entifix-ts-core`, which is a change under the 100% gate with call sites across
  the fleet — deliberately deferred rather than smuggled in.
- **Nothing checks an `@accessor({ labelKey })` in either direction.** The
  use-case key spec covers `@useCase()` descriptors only, and `check-i18n.mjs`
  diffs the locales against each other — so a field key missing from both is
  symmetric and invisible. The four added here were written by hand into both.
- **The register is untouched.** It declares event *names*, and both were already
  on file; the payload's shape is not something `tools/slices/` knows about.
- **Several prices for one offering is still unresolved** — the transition takes
  the first, as ADR 0048 recorded.
