# 72. The realtime slice, the flow-status store, and the edge

- Status: Accepted
- Date: 2026-11-02
- Revised: 2026-11-02 — the edge is built (#475). Locally Envoy runs in a
  container pinned by digest rather than as a host binary, because Envoy
  publishes Linux builds only; the route table is `tools/edge/src/routes.ts`.
- Revised: 2026-11-03 — realtime-service and the flow-status store are built
  (#476, #477). A reopened stream is sent `resync` for **every** topic, flow
  topics included, rather than a replay of flow-status: entifix's resume hook
  is given the cursor and the topics but not the connection, and what it
  returns bypasses the audience filter, so a replay there would hand a flow's
  state to anyone who names its topic. The browser re-reads each pending flow
  from flow-status on that `resync`, through the guarded read. The two flow
  reads are router routes beside the `HttpApi`, like the stream, because a
  read answered to a session **or** a capability fits no endpoint guard kind.
- Area: messaging
- Read when: pushing anything to a browser, asking where a flow stands, or putting a listener on 3000/3001 — one realtime slice owns the stream and the flow-status projection, the audience filter fails closed, and the edge owns the origins
- Revised: 2026-11-04 — `GET /api/saga/:id` is deleted (#490); where a flow stands is answered only by `GET /api/realtime/flow/:id`

## Context

[ADR 0036](0036-the-reactive-stream-is-server-sent-and-same-origin.md) put the
browser stream inside the slice that published the events it carried — the
`transaction` slice, at `GET /api/transaction/events`, reached through a Next
proxy — and rejected a dedicated gateway because a deployment earns its
existence by owning a store. Three things have changed since.

**The stream has nothing to carry.** Its only feed was the single-step tracker,
which left with the specification create's `202` (#463). Flows now run on the
durable engine ([ADR 0066](0066-flows-run-on-a-durable-workflow-engine.md)), and
the events a browser wants come from every commerce slice — `catalog.*`,
`order.*`, `payment.*`, stock changes, and `flow.*` — not from one. Putting the
stream in each publisher gives a tab one `EventSource` per slice, against an
HTTP/1.1 budget of six connections per origin.

**"Where is my flow" has no read model.** `GET /api/transaction/:id` and
`GET /api/saga/:id` answer from the saga runner's own record, which wave 4
deletes. The engine's journal is not a read model: it is the engine's private
storage, keyed for replay, and reading it from a route couples the browser to
an `@stability unstable` package's schema.

**A stream can only cross Next through a route handler.** Next 16.4.2 has no
route-handler upgrade (vercel/next.js#95514), and a streamed `GET` through
`createServiceProxyRoute` holds a Node request open per tab per process. The
browser reaches Next directly on 3000/3001, so there is nowhere else to put it.

entifix 0.14.0 ships the mechanism: `ServerPushTag` and its SSE adapter at
`@entifix/service-shell/push` ([entifix ADR 0021](https://github.com/r10c-technologies/entifix/blob/v0.16.0/docs/adr/0021-server-push-and-the-multiplexed-channel.md)),
and one multiplexed `PushChannel` per tab in the browser. What it leaves to the
host is where the stream lives, who may hear what, and what is replayed.

## Decision

### A `realtime` slice, with no domain and one store

The stream and the flow-status read model belong to one slice, `realtime`. It
declares **no domain** — like `transaction`, a business verb here would put a
domain name in a permission namespace nothing is provisioned for — and owns
**one store**:

| Store         | Plane    | Hosts | Partitioning | Truth                    |
| ------------- | -------- | ----- | ------------ | ------------------------ |
| `flow-status` | platform | —     | single       | `projection-of:workflow` |

That store is what answers ADR 0036's objection: this is not a socket host that
owns nothing, it is the only writer of the flow-status projection, and the
stream is how that projection, and the others below, reach a browser.

- Its shell is `@r10c/shells-effect-realtime`, tagged `shell:platform`, because
  the slice declares no domain ([ADR 0064](0064-failures-reach-the-slice-shell.md)).
- Its deployment is `realtime-service` on **3191**, inspector **9191** — a
  cross-cutting platform service, so a `319x` port beside config-service.
- The slice is declared `planned` in `tools/slices/` by this record and promoted
  by the commit that writes its store (#476, #477).

### Flow-status is a projection, served by non-entity routes

One record per flow — `{flowId, definition, status, step, failure?, audience,
capabilityDigest?, version, updatedAt}` — written by a `work` subscription on
`flow.*` with `dedupe: 'inbox'`. An older `version` never overwrites a newer
one, and a TTL on `updatedAt` retires finished flows.

It is read through `GET /api/realtime/flow/:id` and
`GET /api/realtime/flow?ids=…`. These are **not** entity routes: a flow is not
an `@entity()` and has no permission of its own. A read is answered when the
caller's verified `activeOrganizationId`, its party, or a presented flow
capability (compared by digest, never stored in the clear) matches the record's
audience. Anything else answers `404`, the same answer as not-yet-projected, so
a miss leaks nothing.

### One broadcast queue per replica, and a projection per subscription

Every replica holds different connections, so each one binds a **`broadcast`**
queue ([ADR 0030](0030-failure-retry-and-quarantine-on-the-bus.md)) for the
events the register declares pushable. The flow-status write is the one `work`
subscription, because a projection must be written once rather than once per
replica.

Domain packages never know a browser exists. What a browser receives is decided
by a **push projection** in the realtime shell, one per subscription:

- a **snapshot** of the read-model shape when the audience member's role grants
  the entity's read permission (`ROLE_PERMISSIONS`, never the token) and the
  event carries that shape;
- otherwise a **hint** — `{entity, change, id}` — on which the browser
  re-reads through its own guarded route;
- `flow.completed` and `flow.failed` go to the flow's audience.

`@r10c/slices` fails a broadcast subscription with no projection, and a pushable
event whose schema does not require `meta.audience`.

### ⚠️ The audience filter is per connection, and fails closed

Each connection is matched against an event's audience server-side: organization
entries against `activeOrganizationId`, party entries against the token's
`partyId`, flow entries against a presented capability by digest. **An event
with no audience reaches nobody.** Defaulting the other way makes every
unscoped event a cross-tenant delivery, and that failure is silent in the
direction that matters — ADR 0036's rule, kept.

### The stream: topics in the URL, `Last-Event-ID` on reopen, no control channel

`GET /api/realtime/stream?topic=…&capability=…` opens one SSE stream per tab.

- The topic set and any flow capabilities travel in the URL. A change of
  interest reopens the stream with `Last-Event-ID`; there is **no control POST**
  and no per-connection state shared across replicas, so any replica can serve
  any reopen.
- On a reopen with a cursor, the stream sends `resync` for every topic it
  names, on which the browser re-queries its entity topics and re-reads each
  pending flow from flow-status (`GET /api/realtime/flow/:id`). This replaces
  ADR 0036's "the server does not replay": the catch-up is from a projection
  the slice already owns, not from a per-connection backlog — and it goes
  through the flow read's own audience check, because the push adapter's
  resume hook is not told who is listening and its output skips the filter.
- The stream closes with `event: reauth` before the token expires, and the
  browser refreshes before it reopens. A `401` on reconnect is never the
  mechanism: it kills an `EventSource` for good.
- A capability in a URL is a credential in an access log, so **the edge redacts
  the stream route's query** from its logs.

### The edge owns the origins

A stream cannot cross Next, so the browser stops reaching Next directly.

- **One route table**, generated into a local Envoy config and into Envoy
  Gateway manifests for the cluster. Locally Envoy runs in a container
  (`tools/edge/serve.sh`, the image pinned by digest — Envoy publishes no macOS
  build, and Docker is already required by minikube's driver) owning the
  host's ports; in a cluster it is Envoy Gateway. ingress-nginx is retired and not an option.
- The edge owns **3000** and **3001**. `next dev` moves to **3200** and
  **3201** — `320N` is the origin plus 200 — and every origin routes
  `/api/realtime/*` to 3191. Zitadel's redirects, config-service's origin rows
  and the e2e base URLs keep naming 3000/3001, unchanged.
- HTTP/2 at the cluster edge only. Locally the edge speaks plain HTTP/1.1, and
  one `EventSource` per tab is what keeps a tab inside the connection budget.
- The stream route's timeout is `0 s` and every idle timeout is more than twice
  the push heartbeat (15 s), so no hop closes a quiet stream.
- **Drain:** a `preStop` hook, then the SSE adapter's randomized `retry:`, then
  close — so a rolling restart spreads its reconnects instead of landing them on
  one replica at once.

### A same-origin WebSocket stays possible

It carries the cookie (see ADR 0036, corrected), so a future WebSocket adapter
behind `ServerPushTag` is a transport swap, not a credential redesign. It needs
an **exact `Origin` allowlist**, because a handshake is not CORS-checked. Nothing
here needs it today.

## Consequences

- **Built by #475–#478.** #475 the edge, #476 realtime-service and its shell,
  #477 the flow-status store and its catch-up routes, #478 the back office on
  the channel and the optimistic client. #481 adds stock's projection.
- Every app `dev` will depend on the edge and on realtime-service, and
  `free-ports` stops killing the edge. A storefront fleet without the edge is a
  Next server no browser can reach.
- `back-office-app`'s `/api/transaction` proxy and its config rewrite go with
  #478; nothing proxies a stream after that.
- The SSE adapter's dials — the reauth margin, the retry jitter range and the
  drain window — are config rows for `realtime-service`, not constants.
- Immediate close on revocation is still not built. A revoked session stops
  hearing within one access-token lifetime, the same bound every REST call has.

## Supersedes and revises

- **Partly supersedes** [ADR 0036](0036-the-reactive-stream-is-server-sent-and-same-origin.md):
  the stream's placement in the publishing slice, the rejection of a dedicated
  stream deployment, and "the server does not replay". SSE over a plain `GET`,
  per-connection scoping that fails closed, and the token bounding the
  connection all stand.
- **Revises in place** [ADR 0021](0021-consolidating-the-fleet-into-five-deployments.md)
  (a platform deployment that owns one projection store) and
  [ADR 0030](0030-failure-retry-and-quarantine-on-the-bus.md) (the broadcast
  consumer is realtime-service).
- [ADR 0073](0073-the-optimistic-contract-settles-by-push-and-catches-up-from-flow-status.md)
  is the browser half of this record.
