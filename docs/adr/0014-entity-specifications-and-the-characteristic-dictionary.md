# 14. Vendor-authored entity specifications, pinned per instance, comparable through a platform dictionary

- Status: Proposed
- Date: 2026-08-02
- Revised: 2026-08-12 by [ADR 0022](0022-v1-marketplace-module-boundaries.md) —
  the dictionary is owned by `catalog-reference`, not `marketplace-catalog`.
  Trigger checked and **not** fired: `EntitySpecification`,
  `CharacteristicSpecification` and `DictionaryTerm` exist as entities, but no
  offering carries a vendor-authored characteristic yet.

## Trigger

The first `ProductOffering` that carries a vendor-authored characteristic, or the
first business area onboarded whose products the current fixed entities cannot
describe. Whichever comes first promotes this record to Accepted.

## Context

`Product`, `ProductBrand` and `ProductCategory` are fixed decorated classes.
Adding a field is a commit, a build and a deploy. That is correct for a platform's
own model and fatal for a marketplace meant to host several business areas: every
vendor's product model becomes a platform release, and the operator sits on the
critical path of every onboarding.

There is a second failure that is quieter and worse. A product definition that
changes over time silently reinterprets every record written under the old one. A
characteristic removed in March makes February's rows unreadable; a characteristic
whose allowed values narrow makes them invalid retroactively. Nothing errors.

TM Forum's SID separates the **specification** of a thing from the thing —
`ProductSpecification` / `Product`, `ServiceSpecification` / `Service`. [ADR
0005](0005-business-domain-decomposition.md) already scopes our ODA/SID adoption
to the decomposition and the vocabulary, not the payload shapes. This record
adopts the separation on the same terms.

Two things this record deliberately does **not** do, because both were considered
and both are wrong:

- it does not replace or extend the entifix metadata mechanism;
- it does not make entities dynamic.

## Decision

### Entifix metadata stays the core; a specification is business data written in it

Two metadata systems, at different layers, with different tenants:

|             | entifix metadata             | entity specification                 |
| ----------- | ---------------------------- | ------------------------------------ |
| authored by | a developer, at compile time | a vendor, at runtime                 |
| lives in    | `Symbol.metadata` on a class | rows in a database                   |
| changes via | a commit                     | a use-case                           |
| describes   | `ProductOffering` the type   | what this vendor's offerings contain |

`EntitySpecification`, `CharacteristicSpecification` and `DictionaryTerm` are
themselves ordinary `@entity()`-decorated classes. Consequently the spec designer
is `EntityTable` + `EntityForm` over those classes, persistence is
`makeSqlRepository`/`makeMongoRepository`, the use-cases are the same
`*UCFactory` set, and permissions derive through `permissionForEntity` — all of
it free.

Four red lines. Any of them means the layering has slipped:

- no `EntityConstructor` synthesized at runtime;
- no write to `Symbol.metadata` outside a decorator;
- no spec-aware branch anywhere under `packages/entifix`;
- no characteristic reaching into the RSQL allowlist, which stays constructor-derived.

### The skeleton stays fixed; only characteristics are specification-driven

```
ProductOffering                    ← a decorated class, stable
  code, name, description, brand, category, media, lifecycleStatus
  specRef: { specKey, version }    ← the pin
  characteristics: CharacteristicValue[]
```

Rejected: making the whole entity dynamic. The storefront prerenders, search
projects, checkout prices and stock reserves — all against a stable shape. A fully
dynamic offering means nothing is typed anywhere and [ADR
0009](0009-catalog-authoring-and-publication.md)'s projection has no target shape.
Vendor freedom belongs in the characteristics, which is where the variation
actually is.

### One optional prop is the entire framework change

`EntityForm` already reduces its constructor to `EntityFieldDescriptor[]`
internally (`use-entity-form-fields.ts`). It gains an alternative source:

```ts
entityConstructor?: EntityConstructor<TEntity>;
fields?: EntityFieldDescriptor[];
```

and the business layer supplies a pure mapping, `characteristicsToFields(spec)`.
Entifix learns nothing about specifications; it renders descriptors, as it already
does, and now accepts them from a caller.

Rejected: compiling a specification into a synthesized constructor with populated
`Symbol.metadata`. It works — the decorators only write into a plain metadata
object, so nothing prevents it — and that is exactly why it is dangerous. It fuses
a compile-time framework to runtime business data and makes every entifix consumer
a potential reader of vendor input.

### A released specification version is immutable, and that is load-bearing

Lifecycle, a practical subset of SID's `lifecycleStatus`, paired as TMF pairs it
with a `validFor` period:

```
draft → in-test → active → retired → obsolete
```

`release` freezes the body, computes a content hash, sets `validFor.start`, and
retires the previously active version with a `validFor.end`. `revise` clones an
active version into a new draft at version _n+1_. There is no edit path on a
released version.

Enforcement is route composition, not a flag: the service **does not mount the
generic save/delete routes** for the specification entities at all — only the named
use-cases — and each use-case additionally rejects `409` unless the version is
`draft`. `EntityRepository.save<T>` is generic and therefore bypassable, so the
mounting decision is the actual boundary. `@accessor({ readonly })` is the wrong
tool here: it drops the member from deserialization as well, so the value would
never reach the UI either.

Two entities must be locked, not one. `CharacteristicSpecification` rows are
children of a version; a generic CRUD route on them bypasses the lifecycle
entirely.

Immutability pays three separate times, and this is the reason to take it
seriously rather than treat it as hygiene:

1. a compiled specification cache keyed `(specKey, version)` **never** needs
   invalidation;
2. no distributed transaction is needed across the two stores, because a dangling
   `specRef` is impossible by construction — versions retire, never delete;
3. publication can deduplicate a published specification by content hash instead
   of copying it per offering.

### An instance pins its version

`specRef` is `(specKey, version)`. Reading an instance resolves that version,
never "the current one". Migration therefore becomes **optional**: records written
in February keep validating against the specification they were written under.

`release` also emits a compatibility classification computed from the diff —
added-optional is backward compatible, removed/renamed/narrowed is breaking. That
is what tells the UI whether "move every instance to the new version" is one click
or a project. It does not gate the release.

### Comparability comes from a platform dictionary, not from specification inheritance

The operator publishes a **vocabulary**, not a product model:

```
size@1      enum    XXS|XS|S|M|L|XL|XXL|XXXL
color@3     enum    <palette>
length@1    number  unit mm
voltage@1   number  unit V
```

A vendor characteristic may resolve to a term:

```json
{ "code": "size", "dictionaryRef": "size@1", "allowedValues": ["XS","S","M","L","XL"] }
{ "code": "tecnica", "type": "enum", "values": ["serigrafía", "pintado a mano"] }
```

- `dictionaryRef` present → the platform owns the code, the value set and the
  unit → the characteristic is comparable across vendors and facetable;
- absent → free-form, vendor-owned → renders on a detail page, never in a facet.

Ownership splits cleanly: the vendor owns whether the characteristic appears,
whether it is required, its order, and its display label; the dictionary owns the
code, the value set and the unit.

`allowedValues` is a **subset**, validated `⊆ term.values` at release. Narrowing is
free and expected — vendors stock different ranges. Widening is refused: a value
that looks shared but is not is silent facet corruption, and nothing errors. A
vendor needing a value the term lacks either requests it (the operator releases
`size@2`) or declares a free-form characteristic. Both paths must be offered in
the refusal message, or vendors default to free-form and the dictionary starves.

Because dictionary additions are additive, `allowedValues ⊆ size@1 ⊆ size@2`
always holds, so vendors pinned to different term versions still facet together.
Removals and renames are breaking and take the migration path.

Facet values are derived from **published data with counts**, never from
specification declarations. A vendor's subset is therefore an authoring and
validation concern with no effect on the storefront.

Rejected: mandatory platform templates. Faceting is perfect and self-serve
onboarding is dead — the first business area the operator has not modelled blocks
its vendors completely, which is the failure this whole record exists to avoid.

Rejected: platform base specifications that vendor specifications extend. It
delivers the same comparability, and it costs a **second full versioning system** —
two-level pinning, a rebase use-case, base-release propagation, and collision
handling when a vendor characteristic and a later base characteristic claim the
same code. The dictionary buys the same guarantee with one nullable field.

### A dictionary term names a property, never a label

"Size" means an alpha scale for a shirt, a thread designation plus a length for a
screw, and a EU or US number for a shoe. The collision is caused by naming a term
after a UI word.

```
threadDesignation  enum    M3|M4|M5|M6|M8|M10|M12
length             number  unit mm      ← shared with nails, cable, curtain rods
headType           enum    hex|phillips|torx|slotted
apparelSizeAlpha   enum    XXS|XS|S|M|L|XL|XXL
shoeSizeEu         enum    35|36|…|48
```

Two rules:

1. **measurable → `number` + a dictionary-owned unit.** Numbers with units
   effectively never collide, and one `length` in mm beats `lengthMm` and
   `lengthCm`;
2. **coded scale → `enum`, and the code carries the scale.** `apparelSizeAlpha`,
   never `size`. `shoeSizeEu` versus `shoeSizeUs` is the same collision inside a
   single business area, which is why one `size` term was never going to survive
   apparel alone.

All of them may **display** as "Talla" / "Size": labels are localized and
vendor-overridable, identity is not. Term codes are globally unique, checked at
dictionary release — a collision means the term is named wrong, and it is still
mutable at that point.

Discovery is metadata, not hierarchy: a nullable `appliesToCategories` filters the
term picker in the spec designer. A term with none is offered everywhere. Flat
codes keep the dictionary independent of the category tree.

### The vocabulary grows from evidence

A vendor is never blocked: a business area with no dictionary coverage authors
entirely free-form characteristics, gets full validation and working detail pages,
and loses only cross-vendor faceting. When the same free-form code appears across
many unrelated tenants, that is a term wanting to exist. The operator promotes it
from a requested-terms queue instead of guessing the vocabulary up front.

### Storage: the registry is relational, the values are not

Because the specification entities are ordinary decorated entities, an accessor's
`alias` **is** its SQL column and `serializeEntity` already produces a table row —
so `EntitySpecification` and `CharacteristicSpecification` are a parent and a child
table with no jsonb and no EAV. That makes Postgres a genuine fit, including a
partial unique index enforcing one `active` version per `specKey` — a constraint
that in a document store is a transaction someone has to remember to write.

Instance-side `characteristics` are heterogeneous per specification and belong
embedded in the Mongo offering document.

**But sequence it.** Tenant-plane Postgres does not exist: [ADR
0013](0013-tenant-storage-on-postgres.md) is Proposed and unbuilt. Model the
specification on tenant Mongo first and swap adapters when the entity has settled
— `makeSqlRepository(sql, Ctor)` for `makeMongoRepository(db, Ctor)` is a
composition-root change, which is the whole point of the repository being a port.
This record therefore **does not** promote ADR 0013.

### Planes

Specifications are vendor-authored and tenant-plane. The dictionary is
platform-plane: the storefront and every tenant read it, and it holds no vendor
data.

Per the one-writer rule, the dictionary is owned by **`catalog-reference`** —
platform plane, `system-of-record`, alongside `ProductBrand` and
`ProductCategory`, which are reference data for exactly the same reason a term is
([ADR 0022](0022-v1-marketplace-module-boundaries.md)).

It is **not** owned by `marketplace-catalog`, as this record originally said, and
the reason is a distinction ADR 0020 introduced afterwards: `marketplace-catalog`
is a **projection** store (`truth: projection-of:catalog`) and the dictionary is a
system-of-record. A store carries exactly one `truth`, so the two cannot share
one — which is what makes them two domains rather than one. Both are owned by the
same `marketplace` slice and served by the same deployment, so the "alongside the
published catalog it exists to make comparable" intent is preserved exactly;
only the store boundary moved.

Publication must carry the display schema across the plane boundary, or the
storefront would have to read a tenant-plane specification — the exact isolation
break [ADR 0009](0009-catalog-authoring-and-publication.md) forbids. Publish the
**specification version itself** into the platform plane keyed by its content hash,
shared across every offering that uses it, rather than embedding a copy per
offering. That works precisely because a released version is immutable.

## Consequences

- **The `business:*` tag dimension needs a third tier.** `business:domain` may
  depend only on `business:policy`, `layer:entifix` and `layer:utils`, and the
  constraints are ANDed — so `@r10c/business-ts-common` (`business:domain` +
  `scope:shared`) is unreachable from any domain today. The generic specification
  vocabulary needs `business:kernel ‹ business:policy ‹ business:domain`, with
  `business-ts-common` retagged. Per the standing rule this is a retag, never a
  weakening.
- **`Product` is misnamed and this is the moment to fix it.** The glossary defines
  `Product` as an instance owned by a party; the current class is a
  `ProductOffering`. Leaving both meanings in the tree hardens the collision.
- **v1 characteristic value types are scalar and enum only.** A link-typed
  characteristic would make the number of `useEntityLinkSource` calls vary at
  runtime, and React's hook count must stay fixed. Supporting it later needs a
  single list-taking hook, designed before the first such characteristic, not
  after.
- **Vendor labels are data, not catalog keys.** [ADR
  0003](0003-i18n-mandatory.md) governs authored copy, and a vendor's
  characteristic name will never be in our catalogs. Labels are stored per locale
  on the specification and rendered through the documented runtime-key escape
  hatch. This is a carve-out for vendor data, not a relaxation: authored copy stays
  catalog-bound and the lint gates are unchanged.
- **Characteristics are not RSQL-filterable.** The allowlist stays derived from
  entity metadata, which keeps the filter translators' identifier check intact as a
  security boundary. Characteristic search is a platform-plane concern served by
  the published projection.
- **The dictionary needs an operator surface** — term CRUD, release, and the
  requested-terms queue — plus a platform role to hold it ([ADR
  0007](0007-access-model-planes-roles-entitlements.md)). `release` is a new
  permission action in `ROLE_PERMISSIONS`.
- **Two catalogs of versions to keep honest**: specification versions and term
  versions, each immutable, each with a compatibility classifier.

## Relationship to other records, and the order to work in

| ADR  | Effect                                                                                                                                        |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 0005 | Extended, not changed. `EntitySpecification` / `CharacteristicSpecification` are SID vocabulary; `DictionaryTerm` is ours. Glossary addition. |
| 0003 | Needs the vendor-data carve-out above stated explicitly, or this design reads as a violation.                                                 |
| 0006 | Unaffected. Specifications are organization-agnostic and tenant-plane; the dictionary is platform-plane and touches tenancy not at all.       |
| 0007 | Gains a platform role for dictionary curation and a tenant role for specification authoring.                                                  |
| 0008 | Assigns dictionary ownership to `catalog-reference` (platform, system-of-record); specifications stay in `product-configuration-management`.  |
| 0009 | **Mutual dependency.** Facets require the published projection to exist, and publication must carry the hashed specification version.         |
| 0010 | Untouched for now, but see the follow-up on variant-forming characteristics.                                                                  |
| 0011 | Unaffected while specifications are on Mongo.                                                                                                 |
| 0012 | Required only for operator **moderation** of vendor specifications. Dictionary curation does not need it — the dictionary is platform-plane.  |
| 0013 | **Explicitly not promoted.** Deferred by the sequencing decision above.                                                                       |

Working order:

1. **The `business:kernel` tag tier**, and the retag of `business-ts-common`.
   Everything else imports through it.
2. **Specification entities and lifecycle use-cases** on tenant Mongo; the
   `EntityForm` `fields` prop; `EntitySpecForm`; the `ProductOffering` skeleton and
   the `Product` rename. `dictionaryRef` and `allowedValues` ship in this wave as
   **nullable fields against an empty dictionary** — that is what keeps step 4 from
   being a migration.
3. **Promote ADR 0009** and build publication. No facet is possible before it.
4. **The dictionary**: terms in `catalog-reference`, the operator surface, facets
   computed from published data, the requested-terms queue. The `DictionaryTerm`
   entity itself landed early, with ADR 0022's boundary work; what remains here
   is the surface and the resolution mechanism.
5. **Promote ADR 0012** if and when operators must moderate vendor specifications.
6. **Promote ADR 0013** only if the registry's relational constraints justify the
   move off Mongo — a decision with evidence behind it by then, not before.

## Follow-ups (deliberately out of scope)

- **Variant-forming characteristics.** If size and colour make separate stockable
  units, a specification starts generating SKUs and the combinatorics land on [ADR
  0010](0010-stock-ledger-reservations-and-concurrency.md). This is a substantial
  decision and belongs in its own record.
- Link-typed characteristics, and the single list-taking link hook they need.
- Migrating instances between specification versions, as a saga.
- Unit conversion. v1 declares a unit and never converts.
- Specification import and export, which is how a vendor onboards a catalog they
  already model elsewhere.
