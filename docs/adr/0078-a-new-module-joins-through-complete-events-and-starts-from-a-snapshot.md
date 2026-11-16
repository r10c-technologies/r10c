# 78. A new module joins through complete events, and starts from a snapshot

- Status: Proposed
- Date: 2026-11-16
- Area: messaging
- Read when: adding accounting, cost control, services or manufacturing, or widening an event another slice keeps books from — a module consumes complete events from its activation on, starts from a snapshot, and changes no existing slice

## Context

Four modules are coming — accounting, cost control, services, manufacturing —
and each wants what the fleet already records: sales, money, stock. The fleet
has one consumer of that kind today: settlement keeps its own ledger from four
events and holds no crossing token
([ADR 0057](0057-settlement-joins-the-sale-to-its-payment.md)). It is the model,
and the evidence that today's events were shaped for the consumers that existed:

- **No event is complete.** `order.placed` contracts three members per line —
  `amount`, `quantity`, `currency`
  (`packages/business/ts/order-contracts/src/values/order-event.ts:19-24`).
  `payment.captured` carries the money and its per-order allocations and nothing
  about tax (`packages/business/ts/payment-contracts/src/values/payment-outcome.ts:242-256`).
  Settlement joins the two on the order id because neither is sufficient alone,
  and ADR 0057 **rejected** widening `payment.captured`, on the premise that
  payment would have to read the lines
  (`docs/adr/0057-settlement-joins-the-sale-to-its-payment.md:105-107`).
- **Stock announces counters, not movements.** `stock-item.changed` is
  `onHand`, `reserved`, `available`
  (`packages/business/ts/stock-management/src/events/stock-item-changed.ts:29-40`),
  and only realtime subscribes. A cost consumer cannot rebuild a movement from
  two counter readings.
- **No fiscal fact is stored anywhere.** `ProductOrder`
  (`packages/business/ts/order-management/src/entities/product-order/product-order.entity.ts:55-64`),
  `OrderItem` (`.../values/order-item.ts:41-45`), `Payment`
  (`packages/business/ts/payment-management/src/entities/payment/payment.entity.ts:60-67`)
  and `StockMovement`
  (`packages/business/ts/stock-management/src/entities/stock-movement/stock-movement.entity.ts:32-35`)
  hold no tax, no regime, no tax identifier and no total. A search of
  `packages/` and `apps/` for tax, IVA, NIT or regime finds nothing.
- **An event exists only while someone listens**
  ([ADR 0068](0068-one-outbox-ordered-per-aggregate.md), lines 68-73):
  `payment.failed` and `settlement.run.completed` were dropped for having no
  subscriber. A module that lands later finds the fact it needs unpublished.
- **Nothing keeps history.** The bus is a transport, not a store; a `work` queue
  is declared at its consumer's first boot and starts empty
  ([ADR 0030](0030-failure-retry-and-quarantine-on-the-bus.md), lines 103-104).
  Nothing in the repository is a balance; the nearest thing to a periodic close
  is a `SettlementRun`.

Tax and ERP domains were listed as out of scope until this record
(`docs/adr/0005-business-domain-decomposition.md:176-177`,
`docs/BUSINESS-ARCHITECTURE.md:552-554`). Both lists are revised with it.

## Decision

### 1. A module is a slice that consumes, and writes only its own store

A new module is a slice with its own store, its own domain and its own
deployment ([ADR 0020](0020-stores-and-slices.md)), on entifix like every other.
It learns what happened from the bus and writes **its own** transactions: each
handler claims the inbox and writes the module's records in one unit of work
([entifix 0009](https://github.com/r10c-technologies/entifix/blob/v0.22.4/docs/adr/0009-a-unit-of-work-the-outbox-inbox-and-command-claim-join.md)).

It holds **no crossing token for a read**, and no existing slice gains a route,
a permission, a branch or a subscription on its account. Adding a module is
adding a subscriber.

⚠️ **"Without modifying what exists" has one exception, taken once, now.**
Existing slices state their facts completely (§2) and store the fiscal data
(§6) as part of building this record — not per module. After that, a producer
that must be edited because a module arrived is a defect in §2.

### 2. An event carries the whole fact

The test: **a consumer that has seen only this event, and its own store, can
write its record.** If it would need a second event to learn _what_ happened, or
a read into the producer, the event is incomplete. A producer includes what it
copied from elsewhere at write time — that copy is the fact.

- **`order.placed` / `order.cancelled`** — per line: `offeringId`, description,
  unit price, quantity and the tax breakdown; per order: the seller's fiscal
  identity, net, tax and total, the channel type, the tender. Not the buyer's
  fiscal identity (below).
- **`payment.captured` / `payment.refunded`** — the amount, the tender, and per
  allocation the order's taxable base, tax amount and tax regime.
- **A stock movement event** (working name `stock-movement.recorded`) — the
  movement itself: id, offering, signed quantity, reason, the document that
  caused it, when. It is a second event. `stock-item.changed` stays what it
  is, a counter for a screen: widening it would put a ledger line in a payload
  pushed to browsers.
- **A fiscal-document event** — the one message that carries the buyer's fiscal
  identity. Its name and its publisher follow open question 1.

⚠️ **Payment does not learn to read orders.** ADR 0057's objection was that
payment-service does not hold the lines. It still does not: the checkout flow
already states `allocations[]` into the capture, composed from the orders it
just wrote, and it now states each allocation's tax breakdown the same way.
Payment stores what it was told and announces it. The coupling ADR 0057 feared
never forms.

⚠️ **Complete removes the data join, not the ordering problem.** The relay
orders per aggregate, never across them: `order.cancelled` and
`payment.refunded` still arrive in either order. A module that needs both
occurrences parks the first and never assumes — exactly as settlement does.

⚠️ **The buyer's fiscal identity rides no `order.*` event.** A NIT is personal
data, and `order.*` reaches every subscriber and a vendor's open tabs
([ADR 0076](0076-delivery-destination-buyer-contact-and-the-way-back.md)). It is
stored on the order (§6) and announced only on the fiscal-document event, which
is registered with `audience: 'none'`, so the realtime slice pushes it to
nobody. That event is its own fact — a document was issued — not a missing half
of `order.placed`. Until something issues the document, nothing announces the
identity.

The payload is **built from the contract, member by member** — never the
serialized entity. `order.*` was an open struct over the entity, so whatever
the entity gained reached every subscriber unreviewed. Decoding stays tolerant
of a member a consumer does not read.

### 3. Contracts are stable, and a consumer is idempotent

A contract is the registered Schema in a `business:policy` contracts package
([ADR 0048](0048-announcing-a-publication.md)). **Stable** means a member is
added and never removed, renamed or given a second meaning; a different meaning
is a different event name. `@r10c/slices` fingerprints every registered event
schema, as it does flow fragments
([ADR 0065](0065-use-case-resolution-and-the-routing-slip.md)): a changed
contract fails until the fingerprint is regenerated on purpose, and the failure
names every subscribing slice.

There is **no compatibility machinery**: no version in the routing key, no dual
publish, no upcaster. A change that breaks a consumer moves producer and
consumers in one change and resets the lab. `registerEvent`'s `versioned` flag
keeps meaning aggregate ordering, not schema version.

Members a module keeps books from are **required**. An order with no tax is not
a smaller order; it is a wrong ledger entry.

Every module subscription is `mode: 'work'`, `dedupe: 'inbox'`: the claim on
`(consumer, eventId)` commits with the module's write, so a redelivery is a
no-op and a crash between the two is impossible.

### 4. A module hears from its activation on, and nothing is replayed

A module's queues exist from its first boot and hold nothing older. There is no
replay: no event store, no walk of a producer's outbox, no stream with
retention. RabbitMQ stays as it is. The rebuild walks of ADR 0050 and 0061
re-state a projection's _current_ state; they are not history and a module must
not be built on them.

Activation is **per organization**: a record in the module's own store,
`{ organizationId, activatedAt, openingSnapshotId }`. An event for an
organization that is not activated, or dated before `activatedAt`, is claimed
and dropped.

Rejected: **replay from history.** It makes every past shape of every event a
contract forever, which is the backward compatibility this repository refuses.

### 5. Work starts from a snapshot and never recomputes behind one

- **Opening snapshot.** Activation requires one: the module's position at
  `activatedAt` — an opening balance. It is **authored**, entered or imported by
  a person holding the module's own permission. It is never derived by reading
  another slice.
- **Period close.** A `close` verb over a period — a month, a fiscal year, or
  several years — folds the entries since the previous snapshot into a new one:
  the period, the balances, the snapshot it started from, a content hash. A
  snapshot is immutable. A year closes over twelve month snapshots, not over
  their entries.
- **Nothing recomputes the past.** Any read or close starts from the latest
  snapshot plus the entries after it.

⚠️ **A late event never reopens a period.** An event dated inside a closed
period is posted to the open one as an adjustment that names its original date.
Reopening would change a snapshot something else already started from.

Each module owns its snapshot entity; the period key and the chain are one
shared `business:policy` value. Settlement's run is left alone.

### 6. Orders, payments and stock movements store fiscal data from now on

Stored at write time, whether or not a module is listening — a fact not
recorded when it happened cannot be recovered, and §4 forbids going back for
it. Names are Guatemala's public mechanism (committable,
[ADR 0025](0025-where-planning-and-business-knowledge-live.md)); rates, limits
and process detail stay in Notion.

| Record              | Members                                                                                                 | State                            |
| ------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `Organization`      | `taxId` (NIT), `legalName`, `taxRegime`, `establishmentCode`                                            | regime granularity **open** (Q2) |
| `ProductOrder`      | `sellerTax { taxId, legalName, taxRegime, establishmentCode }`, copied at placement                     | decided                          |
| `ProductOrder`      | `buyerTax { idType: 'nit' \| 'cui' \| 'cf', taxId, name }`, `cf` (consumidor final) when none is given  | decided; never on `order.*` (§2) |
| `ProductOrder`      | `netAmount`, `taxAmount`, `totalAmount`                                                                 | decided; rounding **open** (Q3)  |
| `ProductOrder`      | `fiscalDocument? { type, authorization, series, number, certifiedAt }` — the FEL document (DTE)         | **open** (Q1): who issues it     |
| `OrderItem`         | `kind: 'good' \| 'service'`, `taxTreatment: 'taxed' \| 'exempt'`, `taxRate`, `taxableBase`, `taxAmount` | treatment values **open** (Q3)   |
| `PaymentAllocation` | `taxableBase`, `taxAmount`, `taxRegime`; a `Refund` mirrors its share of them                           | decided                          |
| `StockMovement`     | `occurredAt`, `cause { type, id }`                                                                      | decided                          |
| `StockMovement`     | `unitCost?`, `costCurrency?`; for a receipt `supplierTaxId?`, `documentAuthorization?`                  | **open** (Q4)                    |

The line's description and unit price are ADR 0079's snapshot; this record adds
the tax members beside them. IVA is computed by one pure function, as
`commissionFor` is — in a `business:policy` package, because more than one
domain needs it — stated by the coordinator, stored by the participant, never
recomputed by a consumer.

## Consequences

**To build in r10c**, in this order:

1. **Tax policy package** (S) — regime and treatment vocabularies, the IVA
   function, its rounding rule.
2. **Entities** (M) — the §6 members on `Organization`, `ProductOrder`,
   `OrderItem`, `PaymentAllocation`, `Refund`, `StockMovement`; seeds changed and
   the lab reset.
3. **Flows** (M) — `organization.announced` and the published vendor projection
   carry the seller's fiscal identity; checkout copies it onto each order and
   states the tax breakdown into the capture. Fragment contracts bump
   ([ADR 0065](0065-use-case-resolution-and-the-routing-slip.md)).
4. **Contracts** (M) — `order.*` and `payment.*` widened and built explicitly;
   the stock movement event registered and published from the tenant outbox.
   The fiscal-document event is registered when open question 1 names its
   publisher.
5. **`@r10c/slices`** (S) — the event-schema fingerprint; each module declared as
   a `planned` slice with its subscriptions, which already satisfies the
   publisher check (`tools/slices/src/slices.spec.ts:725-738` reads no status).
6. **Per module** (L each) — the slice, its store, a port index from `3111`
   on, activation, the opening snapshot, the close.

**entifix**: nothing is required — the unit of work, the inbox claim, the outbox
and the registry are in 0.22.4. Optional (S): enumerating registered schemas
for the fingerprint, if the registry does not already expose them.

**What it costs.** A fact is copied into every event that states it, so an event
grows and a contracts package becomes the widest dependency in the fleet. A
module activated in March knows nothing of February except what a person typed
into its opening snapshot. Events are published into an exchange nothing is
bound to until the first module boots.

## Resolved

This record raised seven conflicts with what was already on file. The owner
answered them on 2026-11-16, and each outcome is below. The records named are
revised in place and carry a reciprocal `Revised` line. Nothing is replaced:
this record supersedes nothing.

1. **The rejected widening of `payment.captured`** —
   [ADR 0057](0057-settlement-joins-the-sale-to-its-payment.md) is revised in
   place. Its rejection is scoped to its premise, payment reading the lines.
   The capture is widened by what the checkout flow states into it (§2), and
   settlement's join stays as built.
2. **"An event only when someone listens"** —
   [ADR 0068](0068-one-outbox-ordered-per-aggregate.md) is revised in place. A
   `planned` slice's subscription counts as a listener, which
   `tools/slices/src/slices.spec.ts:725-742` already accepts. An event no
   declared slice names is still not published.
3. **Optional members as a safety property** —
   [ADR 0049](0049-the-publication-snapshot-carries-what-the-storefront-renders.md)
   is revised in place. Its rule is scoped to members a consumer renders, where
   absent means "show less". The fiscal members are required (§3), and the
   change is cut over by a reset.
4. **The buyer's NIT is personal data** —
   [ADR 0076](0076-delivery-destination-buyer-contact-and-the-way-back.md)
   (Proposed) is revised in place. The buyer's fiscal identity is stored on the
   order (§6), rides no `order.*` event, and travels only on a separate
   fiscal-document event with `audience: 'none'` (§2).
5. **Tax and ERP were out of scope** —
   [ADR 0005](0005-business-domain-decomposition.md),
   [ADR 0022](0022-v1-marketplace-module-boundaries.md) and
   `docs/BUSINESS-ARCHITECTURE.md` are revised in place. Storing tax facts is in
   scope and filing is not. The four modules are future slices; the v1
   inventory stays fixed, and its entities gain the §6 members.
6. **Stock's only event is a counter** — stock gains a second, movement-level
   event (§2). `stock-item.changed` is not widened, because that would put a
   ledger line in a payload pushed to browsers. No record is revised; it is
   built with step 4.
7. **`order.*` was an open struct over the serialized entity** — the payload is
   built from the contract, member by member, and decoding stays tolerant (§2).
   No record is revised; it is built with step 4.

## Open questions

1. **Who issues the DTE** — order-service, a `fiscal` slice or the vendor's own
   system (`docs/DEVELOPING.md:1136-1142` already reserves the decision).
2. **Regime granularity.** One `taxRegime`, or IVA affiliation (general, pequeño
   contribuyente) and ISR regime as two. For someone who files, per ADR 0025.
3. **Treatment values** beyond `taxed` and `exempt`, whether a consumer price is
   always IVA-inclusive, and rounding per line or per document.
4. **Unit cost.** No purchase entity exists, so nothing knows a cost at receipt:
   stock records it, or cost control owns valuation outright.
5. **Opening stock quantities** — the one opening figure another slice holds.
   Typed in, or stated once by stock as a movement at activation.
6. **Activation per organization** is this record's reading of "from the moment
   it is activated"; the alternative is one fleet-wide switch per module.
7. **ODA/SID names and port indices** for the four domains
   ([ADR 0005](0005-business-domain-decomposition.md)), and the seller's NIT in
   `published-vendor`, a platform-plane projection.
8. **Retention** of entries behind a snapshot, and of the buyer's fiscal
   identity on an order — a fiscal-law answer.

## Trigger

The conflicts are answered (Resolved, above) and the owner reviews this text.
The record moves to Accepted when §6 and §2 are built and a `planned` module
slice is declared against them.
