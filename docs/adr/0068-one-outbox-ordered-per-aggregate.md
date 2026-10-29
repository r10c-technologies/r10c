# 68. One outbox ordered per aggregate, one idempotency header, and an event only when someone listens

- Status: Accepted
- Date: 2026-10-28
- Area: messaging
- Read when: emitting or consuming a domain event, or making a write safe to retry — events carry aggregate and version, and `Idempotency-Key` is the one header

## Context

Three facts about the bus and its writes had drifted apart:

- **Idempotency rode two carriers.** A saga participant deduped on
  `x-command-id`; the browser's create carried its client-minted id in the
  body ([ADR 0028](0028-the-transaction-id-is-the-clients-and-its-event-ships-with-the-write.md)).
  Neither stored a fingerprint, so a reused key with a different body replayed
  the wrong answer.
- **The outbox drained one queue oldest-first,** so one entry that could not
  publish delayed every aggregate behind it, and events carried no version, so a
  projector ordered on whatever timestamp the payload had
  ([ADR 0048](0048-announcing-a-publication.md)).
- **An event could be published with no subscriber.** `settlement.run.completed`
  is emitted on every run and consumed by nothing
  ([ADR 0057](0057-settlement-joins-the-sale-to-its-payment.md)).

entifix 0.11.0 provides the mechanism
([entifix ADR 0018](https://github.com/r10c-technologies/entifix/blob/v0.11.0/docs/adr/0018-one-outbox-ordered-per-aggregate.md),
[entifix ADR 0019](https://github.com/r10c-technologies/entifix/blob/v0.11.0/docs/adr/0019-the-envelope-is-a-schema-codec-over-an-open-message-registry.md)).

## Decision

### One outbox shape, ordered per aggregate

Every domain event names its aggregate `{ type, id }` and the version of it the
event describes. The relay keeps order within an aggregate and nowhere else, so
a failing head holds back only its own aggregate. A consumer discards a version
at or below the one it last applied, and stores that version with what it
applied — a delete included, so a late older publication never resurrects a
withdrawn offering. The polling relay stays; change data capture is rejected
for the resume-token store and the retention window it would add. The
`workflow` store's events go through a Postgres outbox of the same shape
([ADR 0066](0066-flows-run-on-a-durable-workflow-engine.md)). Stock gains an
outbox when its first consumer lands.

### Where the version comes from

An offering's version is its `publishedAt` and an organization's is its
`announcedAt`, both in epoch milliseconds, so the published-catalog and
published-vendor projectors' existing stamp guards — a stamp written in every
apply, a delete included ([ADR 0048](0048-announcing-a-publication.md)), and a
conditional upsert ([ADR 0061](0061-the-snapshot-carries-media-and-the-vendor-is-a-projection.md))
— already order on the version and store it; nothing is stored twice. An order
is versioned by its linear lifecycle (placed 1, cancelled 2) and a payment by
its decision time. The settlement folds and order's `payment.captured` handler
take no stale-version guard on purpose: they join halves that may arrive in
either order ([ADR 0057](0057-settlement-joins-the-sale-to-its-payment.md)), and
their inbox claim already drops a redelivery.

### `Idempotency-Key` is the one idempotency header

The client-minted id travels as `Idempotency-Key`, an RFC 9651 String, from the
browser to a shell and from the coordinator to a participant. The dedup key is
the caller, the route and the key, plus a fingerprint of the body: no key
answers `400`, the key with another body `422`, a request still in flight
`409`, and a completed one replays its answer. Retention is a dial per service.
`x-command-id` goes.

### An event is published only when a slice subscribes to it

A `publishedEvents` entry with no matching subscription fails `@r10c/slices`.
`settlement.run.completed` is dropped until a payouts process consumes it, and
`payment.failed` — a refused capture, which the saga answers by compensating —
is no longer published either.

### Every message is registered

Each contracts package registers its events with their schemas, so a consumer
decodes rather than casts, and every event in the slices register resolves to a
registered schema.

## Consequences

- A projection is correct under redelivery and reordering by construction.
- **Checks:** the outbox contract suite, the slices "published needs a
  subscriber" and "every event is registered" rules, and a repo-wide ban on the
  literal `x-command-id`.
- **Revises in place:** [ADR 0023](0023-service-to-service-tenant-crossing.md)
  and [ADR 0058](0058-the-order-after-payment.md) (`Idempotency-Key`, not
  `x-command-id`), [ADR 0028](0028-the-transaction-id-is-the-clients-and-its-event-ships-with-the-write.md)
  (the id travels as `Idempotency-Key`), [ADR 0029](0029-the-event-envelope-and-a-routed-bus.md)
  (the closed list is the registry; `version`, `aggregate` and `audience` join
  `meta`), [ADR 0048](0048-announcing-a-publication.md) (the projector orders on
  `version`), [ADR 0050](0050-rebuilding-the-published-catalog-from-tenant-storage.md)
  (the rebuild re-emits at the stored version),
  [ADR 0054](0054-capture-is-the-pivot-and-the-bus-carries-what-follows.md)
  (no `payment.failed`) and
  [ADR 0057](0057-settlement-joins-the-sale-to-its-payment.md) (no run-completed
  announcement).
