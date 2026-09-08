# 47. Authoring an offering, and publication as a verb rather than a field

- Status: Accepted
- Date: 2026-09-07
- Area: business
- Read when: authoring or publishing an offering — `published → published` is legal, and `status` is server-owned or the verb is decoration
- Revised: 2026-09-07 by [ADR 0048](0048-announcing-a-publication.md) — the two
  deferrals below are closed: emission exists, and publishing an offering with
  no price is now refused.

## Context

M1's chain is: author a `ProductOffering` → move it to `published` → emit
`catalog.published` → consume it and write the projection → the storefront reads
real data → delete the fixture. This record covers the first two links
([#143](https://github.com/r10c-technologies/r10c/issues/143) and
[#144](https://github.com/r10c-technologies/r10c/issues/144)).

### Measured

`ProductOffering` and `ProductOfferingPrice` existed as `@entity()` classes and
**nothing else**. No route in marketplace-admin-service, no repository binding,
no REST adapter, no back-office surface, and
`packages/business/ts/product-configuration-management/src/` had `entities/`,
`values/`, `index.ts` — **no `use-cases/` folder at all**. So no vendor could
author an offering, which is the reason `published-catalog` cannot fill.

Two smaller findings came with it. `ProductOffering.id` declared no
`type: 'id'`, unlike `ProductSpecification.id`. And `ProductOfferingPrice` had
no member that could name one of its own records — see below, because that one
decided a design.

## Decision

### The pages are generated; only the two verbs are written

`makeEntityCrud` covers both entities. What is bespoke is the lifecycle.

### Create is plain REST, not the command protocol

`ProductSpecification` is created through the saga because a Redis sequence
assigns its `code` server-side, and drawing from that sequence is exactly the
non-transactional side effect the accept/execute split exists to coordinate
([ADR 0028](0028-the-transaction-id-is-the-clients-and-its-event-ships-with-the-write.md)).

An offering has **no server-owned member**: every value on it comes from the
vendor. Running it through the command path would buy nothing and cost a `202`,
a tracker record and an outbox entry on every create. So the adapter set gained a
second options constant against the _same_ backend —
`CATALOG_SERVICE_REST` — differing only in `create`. Same host, same proxy,
different write contract, which is what `BuildEntityRestOptions.create` is for.

### Publication is a `@useCase()` verb, and there are two of them

Not a status field the generated form can set. #144 puts it plainly: a status
enum a user can write to anything is not a lifecycle, it is a text box with four
suggestions. `publish` and `unpublish` each carry their **own permission
segment**, so a route guarded by `write` cannot let anyone who may edit a draft
put it in front of buyers.

Two use-case classes running one shared effect, which is `retire`'s arrangement:
the _permission_ is per verb — an operator may be trusted to publish and not to
take a live listing down — while the rule they share is one table.

They are granted to **`admin`**, not `super-admin`. An offering belongs to one
organization and lives in that organization's own tenant database, so publishing
it takes nothing from anybody else. That is the inverse of
`catalog-reference:*:retire`, which is the operator's alone precisely because
retiring a brand takes a classification away from every other vendor using it.

### ⚠️ `status` is server-owned, and that is what makes the verb a permission

The verbs would otherwise be **decoration**. `status` is an ordinary writable
member, so a caller holding plain
`product-configuration-management:product-offering:write` could `POST` an
offering that is already `published`, or `PUT` one from `draft` straight to
`published`, and never touch the route that checks `…:publish`. Measured against
the running service before it was fixed: both worked.

The remedy is the one this repository already prescribes for a **server-owned
but client-visible** member — not `@accessor({ readonly })`, which drops the
member from deserialization too so the browser would never see it either, but
leaving it writable and having the route overwrite it, exactly as a save route
already overwrites the id from the path. `saveRoute` gained a `prepare` hook and
`preserveOfferingStatus` uses it: a create is forced to `draft`, an update takes
the **stored** value.

Two consequences follow, and both were found by driving the form rather than by
reasoning:

- **The field is hidden**, because the operator no longer owns it. The state
  stays legible in the list column and in which verb the form offers.
- ⚠️ **`status` had to stop being `required`.** `hiddenFields` hides the input
  and **not its validation rule**, so a hidden required member failed validation
  with no field to render the message on: Save did nothing and said nothing.
  This is the same call ADR 0045 made for `ProductSpecification.code`, for the
  same reason — requiring a value the operator does not control.

### `placement: 'context-independent'` — the form header

By `ACTION_SURFACES` that is the form header. Not `context-dependent`, which is
the row overflow menu: a vendor publishes the offering they have just read and
priced, and a verb on a list row publishes a record whose draft the operator has
not seen.

**Recorded residual:** there is no publish-from-the-list affordance. A verb
declares one placement, and this is the one worth having first.

### The transition table, including the two entries that surprise

`draft`, `pending-review`, `published` and `unpublished` all publish;
only `published` unpublishes.

⚠️ **`published → published` is legal.** Republication is not a mistake to guard
against — [ADR 0009](0009-catalog-authoring-and-publication.md) makes it the
mechanism by which a vendor's edit reaches the storefront, replacing the
projection **wholesale**. Refusing it as "already published" would leave a
corrected price permanently invisible with no error explaining why.

⚠️ **`unpublish` from anything but `published` fails**, and it is the only
genuinely illegal move a person can ask for. It must refuse rather than write
`unpublished` over a draft, which strands the record in a state its author never
chose.

The refusal is `409`, not `400`: the request is well-formed and the caller is
allowed to make it — what is wrong is the state of the record, which is what a
conflict status means. A `400` tells a vendor to fix a request that has nothing
in it to fix.

### Emission stays in Batch B, deliberately

Reaching `published` is what `catalog.published` will hang on, and ADR 0028
requires that event to be written to the outbox **inside the same Mongo
transaction** as the status write — which a framework-free port cannot do,
because a driver session may not enter one. The emitting path therefore belongs
with the commit that decides the event's payload shape, and that shape has a
constraint of its own worth stating here: `product-configuration-management`
authors it and `marketplace-catalog` consumes it, and a `business:domain`
package may not import another, so the payload type cannot simply be shared.

> **Closed** by [ADR 0048](0048-announcing-a-publication.md). The payload lives
> in a `business:policy` package, which is the tag a domain package _is_ allowed
> to depend on; `transitionOffering` now returns the event instead of saving,
> and the route commits both documents in one session.

### `ProductOfferingPrice.offeringId` became `sortable`

⚠️ Not a convenience. `defineRecordSearchSource` refuses a label member that is
not sortable, filterable **and** a `string`, and it refuses at **module load** —
so a price surface declaring anything else fails the app at boot rather than one
render. `amount` is a number and `currency` was not sortable, so `offeringId` is
the only member of that entity that can name one of its own records at all.

## Alternatives rejected

**A status field on the generated form.** #144 offers it as a legitimate interim
and it would have unblocked emission immediately. Rejected because the interim
becomes the design: once the browser can `PUT` any status, the transition rules
have no place to live and the permission for publishing is `write`.

**One `publish` verb toggling both ways.** One button, one grant — and no way to
give someone the ability to publish without the ability to take a live listing
down.

**Folding the price onto the offering.** SID separates them so one offering can
carry a list price and a promotional one, a price per currency, a recurring
price beside a one-off. Folding the amount in makes each of those a second
offering, which is the modelling mistake that turns a subscription into a new
catalog entry.

## Consequences

- **`published-catalog` still cannot fill.** This record ends with an offering
  that reaches `published` and announces nothing. That is the intended halfway
  point, and it is what Batch B stands on. — **Closed** by
  [ADR 0048](0048-announcing-a-publication.md).
- **No precondition on price.** Publishing an offering with no
  `ProductOfferingPrice` succeeds, and the projection will need an amount and a
  currency. It is a real invariant and it needs a second repository in the use
  case; the honest place to add it is the commit that makes the projection
  depend on it. — **Closed** by
  [ADR 0048](0048-announcing-a-publication.md): that commit landed, and the verb
  now answers `409 offeringHasNoPrice`.
- **Five catalog surfaces, and every derived list grew with them** — nav,
  commands, search sources and the workspace registry, none of them edited. The
  pinned-count assertions in four specs failed on the way through, which is the
  mechanism working: each names the number of surfaces it expects.
- **`makeEntityCrud` gained `runUseCase`, because ADR 0035's cell had a renderer
  and no producer.** `EntityForm` has rendered form-header verbs since that
  record and `EntityCrudForm` has accepted an `onUseCase` for as long — but the
  factory never passed one, so the first generated screen to declare an
  entity-bound verb showed a button that did nothing. Two further faults came
  out of the same pass: the rejection was left to the promise, so a `409` from
  an illegal transition reached the console and not the operator; and the verbs
  rendered on the **create** form, where there is no record, so `EntityForm` now
  renders none without an `onUseCase` to run them.
- ⚠️ **A negative assertion about metadata-driven UI must await something that
  metadata gates.** The spec asserting the verbs do not appear on a create was
  written first and passed **vacuously** — it awaited the create title while the
  metadata fetch was still in flight, so it would have passed against the very
  form the live pass then found broken.

## Related

- [ADR 0009](0009-catalog-authoring-and-publication.md) — the lifecycle and the
  projection this implements the first half of.
- [ADR 0026](0026-the-use-case-descriptor-and-served-entity-metadata.md) — why a
  verb is a class with its own permission segment.
- [ADR 0035](0035-entity-actions-selection-and-bulk.md) — the placement map that
  puts these two in the form header.
