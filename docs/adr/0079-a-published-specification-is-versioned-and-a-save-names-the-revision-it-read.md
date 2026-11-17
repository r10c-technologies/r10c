# 79. A published specification is versioned, an instance pins its version, and a save names the revision it read

- Status: Proposed
- Date: 2026-11-16
- Area: business
- Read when: editing a specification something points at, two people saving one record, or a tenant needing its own field or step — a released version is never edited, an order line is a copy, and a stale `revision` answers `409`
- Revised: 2026-11-17 — a missing `revision` answers `400 invalid`, not `invalidBody`, and a status move increments `revision`, as entifix's revision check decides

## Context

The catalog is built on a record anyone with `write` can change under whatever
points at it, and the framework's save cannot tell that it happened.

- **A specification has no version and no lifecycle.** `ProductSpecification` is
  `id`, `code`, `name`, `description`, `brandId`, `categoryId`, `media`
  (`packages/business/ts/product-configuration-management/src/entities/product-specification/product-specification.entity.ts:36-42`),
  served with generic `update` and `delete`
  (`packages/implementation/product-configuration-management/http/src/catalog-api.ts:48-52`).
- **An offering pins nothing.** Its header comment says `specificationId` "pins
  the immutable `EntitySpecification` version"
  (`.../product-offering/product-offering.entity.ts:20-25`); in code it is the id
  of that mutable record (`:41`). The comment states
  [ADR 0014](0014-entity-specifications-and-the-characteristic-dictionary.md)'s
  intent, not behaviour.
- **ADR 0014's entities exist and nothing mounts them.** `EntitySpecification`
  has a `version` and a `released` flag
  (`.../entity-specification/entity-specification.entity.ts:37-38`);
  `CharacteristicSpecification` exists beside it. No route, no `release`, no
  `revise`, no hash. ADR 0014 is Proposed and its trigger has not fired.
- **An order line copies the price and nothing else.** `OrderItem` is
  `offeringId`, `quantity`, `amount`, `currency`, `reservationId`
  (`packages/business/ts/order-management/src/values/order-item.ts:41-45`). Its
  name and description are whatever the offering says today; its tax is nowhere.
- **A save is last-write-wins.** entifix's Mongo repository writes
  `replaceOne({ id }, doc, { upsert: true })`
  (`.entifix/packages/ts/mongo-client/src/adapters/make-mongo-repository.ts:114-139`).
  No entity has a concurrency member; no entity write reads `If-Match`. Races
  that mattered were closed one verb at a time — a hold's `held` filter, a
  shipment's conditional status write, the order's `cancelling` claim.
- **The word "optimistic" is taken.**
  [ADR 0073](0073-the-optimistic-contract-settles-by-push-and-catches-up-from-flow-status.md)
  uses it for a screen showing a write before the server has it.
- **A tenant cannot vary anything without code.** No screen authors a
  characteristic. Configuration rows are keyed `(service, group_name, key)` with
  no organization (`apps/config-service/src/db.ts`). No `defineVariants(` exists
  in `packages/` or `apps/`: the RESOLVE layer of
  [ADR 0065](0065-use-case-resolution-and-the-routing-slip.md) is decided and
  unused.

## Decision

### 1. A released specification is never edited; it is versioned

A specification is a series of **version records** under one stable `specKey`.
Each carries `version` (monotonic per key), `lifecycleStatus` and
`validFor { start, end? }`. The lifecycle is SID's, four states:

```
in-design → active → retired → obsolete
```

- **`in-design`** — the only state with an edit path.
- **`active`** — frozen. `release` moves a version here, stamps a content hash
  and `validFor.start`, and retires the previous active version of the same key
  in the same unit. One active version per key.
- **`retired`** — no new instance may pin it. Instances already pinned keep
  working.
- **`obsolete`** — nothing live pins it. It is kept forever: orders name it.

`release`, `revise` (clone the active version into `in-design` at _n+1_),
`retire` and `obsolete` are `@useCase()` verbs with their own permission
segments, as publication is
([ADR 0047](0047-authoring-an-offering-and-the-publish-verb.md)). `update` and
`delete` are legal from `in-design` only. A version is never deleted once
released.

⚠️ **Hiding the verb is not the rule.**
[entifix 0029](https://github.com/r10c-technologies/entifix/blob/v0.22.4/docs/adr/0029-a-verb-declares-the-states-it-is-legal-from.md)
hides an illegal verb and says itself that this is presentation. The rule is the
handler's conditional write on `lifecycleStatus: 'in-design'`.

It binds `ProductSpecification`, `EntitySpecification` and
`CharacteristicSpecification`, and it is the only lifecycle on file:
[ADR 0014](0014-entity-specifications-and-the-characteristic-dictionary.md)'s
five states are revised to these four, and `EntitySpecification`'s `released`
boolean is replaced by `lifecycleStatus`.

It does **not** bind `ProductOffering` or its price. "Published specification"
means specifications only: an offering is republished and its price replaced,
and what protects a sale from that is §3.

### 2. An instance pins the exact version it was born with

A pin is **the id of the version record** — one id, immutable once released, so
`specificationId` keeps its shape and starts meaning what its comment claims.
`specKey` and `version` are readable on the record it resolves to.

- `ProductOffering.specificationId` pins a version. It may be set to an
  `in-design` version while the offering is a draft; **publishing requires the
  pin to be `active`**.
- The publication snapshot carries `specificationId` and
  `specificationVersion`, both required: publishing requires an `active` pin,
  so no publication lacks either.
- An order line carries both (§3).

⚠️ **Releasing a version moves nothing.** Offerings on version 1 stay on
version 1 when version 2 is released. Moving one is a verb on the offering, by a
person, and never a side effect.

### 3. An order line is a copy of what was sold

At placement the line stores, beside what it has today: `name`, `description`,
`specificationId`, `specificationVersion`, and the tax members of
[ADR 0078](0078-a-new-module-joins-through-complete-events-and-starts-from-a-snapshot.md)
§6. `amount` already is the unit price at purchase. The source is the published
projection the checkout already re-prices every line from
([ADR 0056](0056-the-counter-sale-is-the-checkout-saga.md)), so no new read is
added.

The new members are **required**, except `description`, which a specification
may not have. They are a record of what was sold, not something a screen may
show less of, so
[ADR 0049](0049-the-publication-snapshot-carries-what-the-storefront-renders.md)'s
optional-member rule does not reach them. The widening is cut over by a reset.

After placement **nothing on a line is resolved by reference** — not for a
receipt, not for a refund, not for the books. `offeringId` remains for stock and
navigation only. A vendor renaming an offering changes no past order.

### 4. A save names the revision it read

Every authored record carries **`revision`**: an integer, `1` at create,
incremented by every save. A save states the `revision` it read; the write is
conditional on it. A second save on the same `revision` is refused.

- **The name.** The member is `revision` and the mechanism is the **revision
  check**. Not "version" — a specification already has one, and so does every
  event ([ADR 0068](0068-one-outbox-ordered-per-aggregate.md)). Not "optimistic"
  — that is ADR 0073's word. Neither appears in code or copy for this.
- **Where it travels: in the body.** `revision` is a member of the entity,
  serialized like any other, server-owned but client-visible — so not
  `@accessor({ readonly })`. Lists carry it per row; an autosaved draft keeps it
  with the record ([ADR 0032](0032-what-may-live-in-an-autosaved-draft.md)); a
  command that answers `202` carries it through the journal to the step that
  writes.
- **How it fails.** `409`, `application/problem+json`, `code: 'staleRevision'` —
  a key in the `errors` catalog, category `conflict`
  ([ADR 0064](0064-failures-reach-the-slice-shell.md)). An update with no
  `revision` is `400 invalid`, the framework's own failure, with the field
  problem at `/data/revision`, never a silent overwrite.
- **What a person sees.** The form keeps what they typed, says the record
  changed, and offers the current one. It never retries by itself.

Rejected: **`If-Match` and an `ETag`.** It is the HTTP-native answer and it loses
three times here. Every same-origin proxy must forward the header both ways —
the `$metadata` proxy had to be taught to
(`packages/shells/next/auth/src/server/routes.ts:329-351`). An `ETag` is per
response, so a list row has none. And a header does not reach a flow step or an
autosaved draft.

⚠️ **The revision check is for documents a person edits, and wrong for the
rest.** Excluded: quantities and ledgers, which are `$inc` over append-only
movements and never read-modify-written
([ADR 0010](0010-stock-ledger-reservations-and-concurrency.md)); status moves,
which keep their one conditional write on the status they leave and are never
refused for a `revision`, but increment it in that same write when the record
carries one, so a form opened before the move cannot save over it;
projections, ordered by the event's version; append-only records. A `revision`
is not an event's `meta.version` and feeds none of the existing ones.

### 5. A tenant varies data through characteristics and process through configuration

**Data, with no code.** A tenant adds a `CharacteristicSpecification` to its own
specification while it is `in-design`. Values live on the instance, validated
against the pinned version, and the form renders them from the pinned version's
descriptors. ADR 0014's four red lines stand: no entity class synthesized at
runtime, no spec-aware branch in entifix, characteristics never in the RSQL
allowlist.

**Process, with no fork.** A use case that differs per tenant is a **variant**
resolved by the use-case router (ADR 0065), and the tenant's side of the choice
is **tenant configuration**: a closed, typed set of settings per organization
that joins the verified context a `When(` predicate reads.

- A setting selects among variants that are **code, reviewed and enumerated by
  CI**. It is never an expression or a rule a tenant writes —
  [entifix 0015](https://github.com/r10c-technologies/entifix/blob/v0.22.4/docs/adr/0015-composed-flows-and-use-case-resolution.md)
  discarded that, and this keeps it discarded.
- An **entitlement** is what an organization may do, set by the operator
  ([ADR 0007](0007-access-model-planes-roles-entitlements.md)). **Tenant
  configuration** is what it chose among that, set by its own admin. A setting
  never widens an entitlement.
- No `if (organizationId === …)`. A tenant-specific branch outside a variant is
  a defect.
- **Where it lives: config-service.** Tenant configuration is rows scoped to an
  organization, beside the fleet's `(service, group_name, key)` rows. The
  `configuration` store stays control-plane and single: like an entitlement, a
  setting is the platform's record about an organization, not tenant data.

## Consequences

**To build in r10c:**

1. **Specification lifecycle** (M) — `specKey`, `version`, `lifecycleStatus`,
   `validFor`, the content hash and the four verbs on `ProductSpecification`;
   `update`/`delete` guarded; `EntitySpecification.released` replaced by
   `lifecycleStatus`; seeds and the mock catalog rewritten; lab reset.
2. **Pins and copies** (M) — the publish guard, the two snapshot members, the
   `OrderItem` members and the `order.*` line; fragment contracts bump.
3. **Adopting `revision`** (M) — every authored entity, every form and draft,
   the `staleRevision` copy in both locales, the conflict state on the form.
4. **Characteristics** (L) — mounting `EntitySpecification` and
   `CharacteristicSpecification`, the designer, values on the offering. This is
   ADR 0014's build and keeps its order of work.
5. **Tenant configuration and the first variant** (M) — organization-scoped
   rows in config-service, the closed set of settings, and the first
   `defineVariants(` with its suite.

**entifix must change, first** ([ADR 0059](0059-entifix-leaves-the-repo.md)):

- **The revision check** (L, breaking) — a declared `revision` member, `save`
  conditional on it in the Mongo, SQL, static and REST adapters, a typed
  `StaleRevision` failure under `conflict`, the contract suites, the form's
  conflict state.
- **Runtime field descriptors on `EntityForm`** (M) — ADR 0014 plans a `fields`
  prop (lines 102-109); a search of the 0.22.4 `entity-form` organism finds none.
- Nothing for §1–§3 or for variants: verbs, legal states and
  `defineVariants` are there.

**What it costs.** A typo in a released specification is a new version and a
verb per offering to adopt it. Every authored write gains a member the client
must return. A specification's history is permanent storage.

## Resolved

This record raised eleven conflicts with what was already on file. The owner
answered them on 2026-11-16, and each outcome is below. The records named are
revised in place and carry a reciprocal `Revised` line. Nothing is replaced:
this record supersedes nothing.

1. **What happens to ADR 0014** —
   [ADR 0014](0014-entity-specifications-and-the-characteristic-dictionary.md)
   (Proposed) is revised in place. This record owns lifecycle, pinning and
   tenant variation. ADR 0014 keeps what a specification _is_: the red lines,
   the dictionary, storage, planes and its trigger.
2. **Five states or four** — four, SID's, as §1 lists them. ADR 0014's `draft`
   is renamed `in-design` and its `in-test` is dropped.
3. **The pin's shape** — the id of the version record (§2), not the pair
   `{ specKey, version }`. A cross-store reference is an id, and no reference
   changes shape.
4. **A specification was edited freely** —
   [ADR 0049](0049-the-publication-snapshot-carries-what-the-storefront-renders.md)
   is revised in place: the `PUT` that blanks `code` cannot reach a released
   version. `EntitySpecification`'s `released` boolean is replaced by
   `lifecycleStatus`; the two do not coexist.
5. **Offerings and prices are not versioned** — "published specification" means
   specifications only (§1). An offering is republished and a price replaced,
   as [ADR 0047](0047-authoring-an-offering-and-the-publish-verb.md) and
   [ADR 0009](0009-catalog-authoring-and-publication.md) have it; what protects
   a sale is the order line's copy (§3). No record is revised.
6. **New snapshot and order-line members** — required, following
   [ADR 0078](0078-a-new-module-joins-through-complete-events-and-starts-from-a-snapshot.md)'s
   answer on optional members: they are a record of what was sold, not
   something a screen may show less of. The one exception is the line's
   `description`, optional because a specification may have none (§3).
7. **`save` was an unconditional upsert** — the revision check lives in
   entifix, for every adapter, as a breaking change (§4, Consequences). It is
   not closed entity by entity in r10c's cells.
8. **The name** — `revision` (§4). A specification's `version`, an event's
   `meta.version` and a stock item's `version` keep their names and their
   meanings.
9. **Quantities, status moves and projections** — excluded from the revision
   check, as §4 lists them.
10. **Body member, not `If-Match`** — `revision` travels in the body (§4).
11. **Tenant configuration's home** — organization-scoped rows in
    config-service (§5). Who may write one, and how it is read, stay open
    question 4.

## Open questions

1. **Moving an offering to a newer version**: the verb's name, whether a
   published offering may take it, and what a breaking version does to values.
2. **Characteristic values on the order line**, as sold.
3. **`obsolete`**: a person's verb, or automatic when the last pin is gone.
4. **Who may write a tenant setting**, and whether it is read per request or
   announced like an entitlement.
5. **A stale `revision` inside a flow**: fail the flow with `staleRevision`
   through flow-status (assumed here), or compensate.
6. **`specKey`**: the sequence-assigned `code`, or a key of its own.

## Trigger

entifix shipping the revision check. The conflicts are answered (Resolved,
above) and the owner reviews this text. The record moves to Accepted when a
released `ProductSpecification` refuses an edit and a second save on one
`revision` answers `409` on the live fleet.
