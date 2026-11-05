# 36. The reactive stream is server-sent, same-origin, and scoped per connection

- Status: Accepted
- Date: 2026-09-02
- Area: messaging
- Read when: pushing anything to a browser — SSE and not a socket, because Next cannot upgrade a route handler and every consumer reads one way; where the stream lives is ADR 0072's
- Amended by: [ADR 0043](0043-the-optimistic-mutation-contract.md) — "on reconnect
  the client re-queries its pending transaction ids and reconciles" is built, and
  `ReactiveChannel` gains an `onConnect` signal (which replays for a listener
  registered while the stream is already open) to drive it. Declining replay, and
  every other decision here, stands.
- Revised: 2026-10-29 — `/api/transaction/events` left with the tracker that fed it (#463); the decision stands for the push of flow outcomes ADR 0066 builds
- Revised: 2026-11-02 by [ADR 0072](0072-the-realtime-slice-flow-status-and-the-edge.md) — partly superseded: the stream's placement in the publishing slice, the rejection of a stream deployment and "the server does not replay"; and corrected in place, since a same-origin WebSocket handshake does carry the `Lax` cookie
- Revised: 2026-11-04 — the access token's lifetime that bounds a revoked session's stream is the `session.accessTokenTtlSeconds` row rather than a constant (#492)

## Context

`ReactiveChannel` is the right port and it has never carried a message.

**The seam is wired end to end and fires never.**
`workspace-view.tsx` builds a `makeInMemoryReactiveChannel()` at module scope,
`useReactiveInvalidation` subscribes to it, and the listener invalidates
`['entity', <name>]` — the same prefix `makeEntityCrud`'s generated lists already
key on. Nothing in the repository ever calls `emit`. So every part of the
reactive story exists except the one that would make it observable, and a reader
of the workspace cannot tell the difference between "the transport is missing"
and "nothing changed".

> **Corrected 2026-11-02.** This paragraph first argued that a WebSocket could
> not carry the session, because a `Lax` cookie is not sent on a cross-site
> handshake. That is true and beside the point: a handshake to the page's own
> origin is same-site, and the browser sends the cookie with it exactly as it
> does with a `fetch`. A same-origin WebSocket needs no second bearer class. What
> it does need is an **exact `Origin` allowlist**, because a handshake is not
> CORS-checked and a hostile page can open one to any address.

**A browser cannot reach a service directly with its session.**
`rewriteServiceDomains` exists for one reason: `entifix_at` is `httpOnly` and
`sameSite: 'lax'`, so a browser pointed at `:3101` sends no session and gets a
`401`. Every service address the browser sees is rewritten to a same-origin
proxy path before it leaves `GET /api/config`, and `createServiceProxyRoute`
turns the cookie into a bearer token server-side. Whatever transport the push
uses has to arrive on the page's own origin too.

**`TransactionEvent` carries no organization.** Its members are
`transactionId`, `entity`, `state`, `step`, `code`, `entityId`, `error`, `at`.
There is no `organizationId` anywhere on the event or on the envelope around it,
so "deliver this only to connections belonging to the vendor it happened in" is
not expressible today. This is the decisive gap, and it is not the one the issue
predicted: the correlation id and the timestamp #136 asked for already exist on
`EntifixEventMeta` as `correlationId`, `id` and `at`.

**And the endpoint this replaces is unauthenticated and cross-tenant.**
`sagaRoutes` mounts `GET /api/transaction` and `GET /api/transaction/:id` with no
`requirePrincipal` and no organization filter. `listRoute` answers `store.list()`
— every tracked transaction from every organization — and the `/api/admin`
catch-all proxy forwards any path, so a browser reaches it. Designing
per-connection scoping for the push while the poll beside it hands out the same
data to anyone is not a defensible place to stop.

## Decision

### Server-sent events, not a WebSocket

The stream is a plain `GET` answering `text/event-stream`, terminated in the
service and reached through the app's **existing** same-origin proxy. The cookie
flows exactly as it does for every other call in the repo, so there is no ticket,
no CORS, no second bearer class and no new dependency.

The duplex frame buys nothing here. `ReactiveChannel.subscribe(listener)` is
one-directional by construction, and so is every consumer named on the milestone:
#136 invalidates query keys, #137 settles an optimistic write on the outcome
event. A client→server frame has no caller.

What SSE adds beyond parity is the half #137 would otherwise hand-write:
`EventSource` reconnects on its own with backoff, and re-sends the last message
id it saw as `Last-Event-ID`. Reconnect is the requirement #137 names as the one
whose absence is "worse than no optimism at all", and it arrives as browser
behaviour rather than as our retry loop.

**Rejected: a WebSocket.** The plumbing is genuinely available —
`HttpServerRequest.upgrade` yields a `Socket.Socket`, and `NodeHttpServer`
already registers an upgrade handler that routes through the same `HttpRouter`.
The reasons against it are three, and none is the cookie (see the correction
above):

- **Next cannot upgrade a route handler** (Next 16.4.2, vercel/next.js#95514),
  and the browser reaches the services only through Next, so a socket has no
  same-origin path to its service;
- **every consumer reads one way**, so the duplex frame has no caller;
- **SSE keeps HTTP semantics** — a plain `GET`, the same middleware, status
  codes, caching headers and access logs — and `EventSource` reconnects with
  `Last-Event-ID` on its own.

⚠️ One property of `EventSource` shapes everything that follows: a reconnect
answered `401` closes it for good, with no further retry. A stream bounded by
the token must therefore close _before_ the token expires, never let the
reconnect fail.

**Rejected: terminating in Next.** An App Router route handler receives a
`Request` and can never upgrade a connection. Replacing the server to get one
abandons `next dev` and `next start`, and a Next backend is composition, not a
connection holder.

**Rejected: a dedicated gateway deployment.** One socket host fanning out to
every browser is the tidiest diagram and owns no store. ADR 0021 deleted
`marketplace-service` for precisely that shape, and ADR 0020 gave the rule it was
deleted under: a deployment earns its existence by owning a store.

> **Superseded 2026-11-02 by [ADR 0072](0072-the-realtime-slice-flow-status-and-the-edge.md).** The rule holds and the premise moved: the
> stream now lives in a `realtime` slice that owns the `flow-status` projection,
> so it is a deployment with a store, and one stream per tab replaces one per
> publishing slice.

### It terminates in the service, behind `requirePrincipal`

A route on the same `HttpRouter` and the same port as the service's REST surface,
streaming its response. The principal comes from the verified token the proxy
forwarded, through the same `resolvePrincipal` every other route uses — there is
no second authentication path to keep in step, which is the property the
handshake-ticket design could not have.

### The `transaction` slice owns it, at `GET /api/transaction/events`

> **Superseded 2026-11-02 by [ADR 0072](0072-the-realtime-slice-flow-status-and-the-edge.md)** — the stream is
> `GET /api/realtime/stream` on realtime-service, reached through the edge rather
> than a Next proxy.

Not `marketplace-admin`, and the reason is enforced rather than stylistic:
`slices.spec.ts` asserts no slice subscribes to its own events, and
`marketplace-admin` publishes `transaction.*`.

The `transaction` slice is also where it belongs on the merits. It already
subscribes to `transaction.*`, and `GET /api/transaction/:id` is already the
endpoint a client polls after its `202`. This is that endpoint upgraded from poll
to push, serving the same facts to the same caller — not a new capability looking
for an owner. The two share a process today (ADR 0021) and the `202`'s status
link is relative, so splitting the slice back out to `:3103` moves the stream
with it and changes no contract.

### `mode: 'broadcast'` — the consumer ADR 0030 built the mode for

Every replica holds different connections, so every replica must receive every
event. A `work` queue delivers each message to exactly one replica, and the
clients attached to the others simply never learn — which reads as flakiness
rather than as a defect, because nothing errors. This is the first `broadcast`
declaration in the register; ADR 0030 named this consumer by number when it
declined to make broadcast the default.

The exclusive queue's weakness is deliberately acceptable here: a message
published while a replica restarts is lost, and that is correct for a push whose
audience is a set of live connections that also did not exist during the restart.

### The frame is an `EventEnvelope`, and no fourth framing is invented

ADR 0029 collapsed the message framings to one and named `EntityChangeEvent` as
the third that must not multiply. It does not: the stream carries an `event`
envelope, and `EntityChangeEvent` is its `data`.

`EntityChangeListener` therefore widens to
`(event: DomainEvent<EntityChangeEvent>) => void`. The fields #136 asked to add
already exist one level up and are not duplicated onto the payload:

| #136 asked for  | Where it already is                                |
| --------------- | -------------------------------------------------- |
| `transactionId` | `meta.event.correlationId`                         |
| a timestamp     | `meta.event.at`                                    |
| a sequence      | `meta.event.id` — `<transactionId>:<step>`, unique |

The SSE `id:` field carries `event.id`, so `Last-Event-ID` names a message that
actually exists rather than a counter invented for the wire.

### ⚠️ Scoping is per connection, from the verified principal, and it fails closed

`TransactionEvent` gains `organizationId`. It goes in `data` rather than in
`meta`, under ADR 0029's rule: `meta` describes the message, `data` describes the
occurrence, and which vendor's catalog a record was written in is a fact about
what happened.

The filter runs server-side, per connection, against `principal.organizationId`.
Never a client-side filter — that is the same mistake as a client-side search
index, and here it would ship every organization's writes to every browser and
rely on the browser to discard them.

**An event carrying no organization is delivered to no tenant-scoped
connection.** Defaulting the other way makes every unscoped event — including
every event emitted before this field existed — a cross-tenant delivery, and the
failure is silent in the direction that matters.

### ⚠️ The connection is bounded by the token, not by the session

> **Revised 2026-11-02 by [ADR 0072](0072-the-realtime-slice-flow-status-and-the-edge.md)** — the bound stands, but the stream now closes
> with `event: reauth` before the token expires and the browser refreshes before
> it reopens. A reconnect answered `401` closes an `EventSource` permanently, so
> "a reconnect that fails `401`" below is a dead stream, not a second signal.

The stream closes when the verified access token expires. `EventSource`
reconnects, the browser sends the cookie the app refreshed in the meantime, and
the new connection is authenticated from a new token.

A revoked session therefore stops receiving within the access token's lifetime
(the `session.accessTokenTtlSeconds` row, 15 min as seeded). That is not a weaker bound than the rest of the system — it is exactly
the bound `requirePrincipal` already gives every REST call, since verification is
stateless and never consults the session store. A held-open connection with a
handshake-only check would have been weaker, which is the difference this decides.

In practice it is tighter than what exists: `useSessionRefresh` polls every
~12 minutes and is the only channel by which a browser currently learns its
session died. A reconnect that fails `401` is a second one, arriving on the
stream's own schedule.

An immediate close on revocation is deliberately **not** built here. It needs the
`auth` slice to publish a session-revoked event and every stream host to hold a
session→connection index, and it shortens a window that already matches the REST
surface. It is what #53 should build, and the trigger for building it is the first
requirement that a specific person's access stop in seconds rather than minutes.

### The server does not replay

> **Superseded 2026-11-02 by [ADR 0072](0072-the-realtime-slice-flow-status-and-the-edge.md)** — a reopen replays from the `flow-status`
> projection for `flow:` topics and sends `resync` for entity topics. The
> objection below, to a per-connection backlog, still stands; the replay is not
> one.

`Last-Event-ID` is accepted and ignored. On reconnect the client re-queries its
pending transaction ids and reconciles — #137's work, and the thing it has to do
anyway for a tab that was closed rather than disconnected.

Answering `Last-Event-ID` from the outbox would make it a per-connection backlog
with a retention policy, an eviction rule and a second durability contract beside
ADR 0028's. The stream is a hint that something changed; the record is the truth,
and re-reading it is cheap.

## Consequences

- **`createServiceProxyRoute` must learn to stream.** It reads the upstream body
  to completion before responding, which against `text/event-stream` holds the
  request open forever and delivers nothing. There is no error and no timeout —
  it is the most likely way to build #136, see silence, and go looking in the
  wrong service. The proxy also must not buffer or transform the body, and must
  pass `content-type` and `cache-control: no-store` through.
- **The two saga routes are guarded in the same commit as the stream.**
  Per-connection scoping beside an unauthenticated `GET /api/transaction` that
  lists every organization's transactions is theatre. Both gain
  `requirePrincipal` and the same organization filter the stream applies.
- **Non-transactional writes still reach no browser.** Only the command path
  publishes, so a plain REST `PUT` or `DELETE` produces no event and no
  invalidation. Named rather than fixed: the path is opting more writes into the
  command envelope ADR 0028 already provides through `create: 'command'`, not a
  second change-event class emitted from the repository layer.
- **No `dev:reset`.** A broadcast queue is exclusive and auto-deletes with its
  connection, so nothing is re-declared with different arguments — the
  `PRECONDITION_FAILED` trap `x-delivery-limit` carries does not apply.
- Widening `EntityChangeEvent` touches `useReactiveInvalidation` and its two
  specs. `@entifix/react-integration` sits above `@entifix/core`, so importing
  `DomainEvent` there is a legal edge.
- `back-office-app` imports from `@entifix/react-integration` without
  declaring it, resolving transitively. The build that adds the stream should fix
  the declaration rather than inherit it.
- One stream per proxied service, not one per entity or one per tab. Only
  `:3101` publishes today, so the browser opens one — worth restating when a
  second service starts emitting, because SSE shares the origin's HTTP/1.1
  connection budget.

## Trigger

Built by #136 (the transport and the correlatable change event), which lands the
`organizationId` member, the broadcast subscription in the register, the proxy's
streaming arm and the two route guards together. #137 stands on it, #128 on
that, and #53 inherits the revocation question this record scopes out.

## Amends

- [ADR 0028](0028-the-transaction-id-is-the-clients-and-its-event-ships-with-the-write.md)
  — the client-minted id, the idempotency key, the outbox and the at-least-once
  contract all stand. What changes is `TransactionEvent`'s payload: it gains
  `organizationId`, because an event that leaves the tenant plane to be routed to
  a browser has to say whose it is, and until now it could not.
