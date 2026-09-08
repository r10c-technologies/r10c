# 50. Rebuilding the published catalog from tenant storage

- Status: Accepted
- Date: 2026-09-08
- Amends: [ADR 0048](0048-announcing-a-publication.md) — the fleet-wide rebuild
  it deferred is built, and the reason it gave for deferring is answered.

## Context

M1's chain is: author a `ProductOffering` → publish it → emit
`catalog.published` → project it → the storefront reads real data → delete the
fixture. ADR 0047 built the first two links, ADR 0048 the next two, and ADR 0049
widened the payload enough to render a card.

What none of them gave the projection is **completeness**. It is fresh — every
announcement that reaches the bus lands — and it is empty on a lab that never
announced anything.

### Measured

**The seed writes offerings straight into tenant Mongo.** `offeringTempData`
cycles four statuses, so one in four seeded offerings is stored `published`
having run no transition: nothing emitted, nothing projected, and
`published-catalog` empty after every `dev:reset`. The moment
[#148](https://github.com/r10c-technologies/r10c/issues/148) deletes the
storefront fixtures, a freshly reset fleet serves an empty store until somebody
opens each offering and republishes it by hand.

**And delivery is not atomic although the write is.** ADR 0048 measured this
during its own live pass: with the broker stopped, the relay retried the pending
entry to `outbox.maxAttempts` and quarantined it — ADR 0030's deliberate
quarantine-and-skip so the head of the line moves — after which the offering read
`unpublished` in the tenant store and stayed live on the storefront, with nothing
reporting it.

### Two things the issue assumed, and neither exists

[#215](https://github.com/r10c-technologies/r10c/issues/215) proposed resolving
organizations "through auth-service's own read path with the service token", and
per-tenant handles from ADR 0023's explicit-`organizationId` provider. Both were
checked and both are absent.

`Organization` lives in `party-management` and is seeded into auth-service's
control-plane Mongo, but **no route serves it** — `auth-service/src/routes.ts`
never imports the class, and nothing in the fleet requests `/api/organization`.
ADR 0023's second `TenantContextTag` provider is likewise design only: that
record's own Trigger says "already fired in design, not yet in code", and the tag
has exactly one reference in the repository, its own definition.

## Decision

### The walk is the owning slice reading its own stores

`tenantDatabases(client, prefix)` already exists, in the outbox relay, under a
comment that settles the question:

> Enumerating is legal here and nowhere else: `marketplace-admin` is the single
> writing slice of every `tenant_<organizationId>` store, so the relay is reading
> its own. A slice that does not own a store may not do this.

The rebuild is a background job of that same slice, sitting beside that same
sweep, so it needs no service token, no new permission, no new upstream and no
new route. `vendorId` is the database name minus the prefix.

This is what answers ADR 0048's stated reason for deferring — "it needs a
cross-tenant surface and ADR 0012's audited human crossing is still Proposed".
That reason presumed a _caller_. ADR 0012's crossing is discretionary: a person
picks an organization, so it needs a human's permission, a time box and a
`Crossing` record. ADR 0023's is determined by an item a service was handed. This
is neither, because nobody outside the slice is asking for anything: the slice is
walking storage it alone writes.

### ⚠️ The offering stores the moment its status was decided

`ProductOffering` gains `statusChangedAt`, written by `transitionOffering` on
**both** transitions. Without it a rebuild has to stamp `now`, and that is unsafe
rather than merely lossy:

- the event id is `<offeringId>:<publishedAt>`, so a re-stamped moment makes the
  message a **new publication** rather than a redelivery — the outbox's unique
  index and the projector's guard both wave it through;
- and it **overwrites the projection's ordering key**, so a genuine
  `catalog.unpublished` emitted a second earlier is then read as stale and
  ignored. The offering stays live on the storefront while the vendor's own screen
  says it is not — which is the exact failure ADR 0048's tombstone was written to
  stop, reintroduced by the tool meant to repair it.

With the moment stored, the walk's idempotence is the same mechanism everything
else on this bus already uses rather than a second rule: a `Date` round-trips
through BSON at millisecond precision, `toISOString()` renders no more than that,
so the re-emitted event id is byte-identical to the original's.

`statusChangedAt` and not `publishedAt`, because an unpublish stamps it too — on
a withdrawn record the second name would describe the takedown. The payload keeps
`publishedAt`, which has always carried a takedown's moment for the consumer's
ordering guard.

⚠️ **It is server-owned, so it is neither `readonly` nor `required`.**
`readonly` drops a member from serialization _and_ deserialization, so the walk
would read `undefined` off every stored document; `required` on a member the
operator does not control is the failure ADR 0047 measured on `status`, where a
hidden field's validation rule still ran with no input to render its error on.
The form hides it, and `preserveOfferingLifecycle` keeps a `PUT` from blanking
it — which is ADR 0049's `preserveSpecificationCode` residual, arriving early for
the member that needs it most: a blanked moment removes that offering from every
future rebuild, silently, while its record still reads `published`.

### Already announced is skipped; quarantined is revived

The outbox retains sent entries, so re-emitting an unchanged publication answers
`duplicate`. That is the right answer for an announcement already delivered and
the wrong one for an entry the relay gave up on — the single case ADR 0048 says
only a rebuild fixes. So `reviveQuarantined` resets exactly those, with
`quarantined: true` in the **filter** rather than the update.

Re-announcing everything was the alternative and is rejected. At boot it would
re-publish the whole fleet on every restart, and it would un-quarantine genuine
poison every time — the re-drive loop ADR 0030 closed on purpose.

The cost is stated rather than hidden: **a projection lost while tenant storage
survives is not repaired**, because every entry reads `sent: true` and the walk
skips it. Repairing that needs an operator-triggered force, and a force needs an
authorization surface for a fleet-wide action that this deliberately did not
invent.

### It reuses the transition rather than building a payload

For each stored-`published` offering the walk runs `transitionOffering` with
`transition: 'publish'` and the **stored** moment. `published → published` is
legal (ADR 0047: republication is how a vendor's correction reaches the
storefront), so the use case produces exactly the message the original
publication produced, through exactly the same code, including both
preconditions. The moved offering is discarded — its status is already what the
transition set it to, so there is nothing to save and no transaction to open.

A second payload builder here would be the second declaration site ADR 0049
deleted from the projector, and it would drift the first time a member is added
to the snapshot.

A refusal is then a _report_, not a failure: an offering whose price or
specification is gone is counted `unannounceable`, named in a log with its id,
and the walk continues.

### It runs once at boot, chained to the seed

`Layer.effectDiscard` in the AppLayer, beside `seedCatalog`, `startTracking` and
`startOutboxRelay`, and forked so a fleet-wide scan does not hold up the server.

⚠️ **Chained to the seed, not merged beside it.** `Layer.mergeAll` builds its
members concurrently, so a sibling rebuild races the seed on a fresh
`dev:reset`: Mongo creates a tenant database on its first write, so
`tenantDatabases` lists nothing, the walk announces nothing, and the storefront
is empty — intermittently, which is the worst version of the defect this closes.

No shutdown hook: it is a one-shot, and interrupting a partial walk loses nothing
the next boot does not redo.

### The seed stamps a fixed moment

`offeringTempData` carries a constant `statusChangedAt`, not `new Date()` at
module load. A moment that moved with each boot would give every reset different
event ids and make each restart look like a fresh publication; a constant makes a
seeded lab reproducible, which is what lets a test name one. It sits in the past,
so any transition a vendor makes later carries a newer moment and wins.

⚠️ It reaches a lab only through a reset: `seedCollection` inserts on
`count === 0`, so an existing tenant database keeps its unstamped rows and the
walk reports them `unstamped`. There is no back-compat path and none is wanted.

### Failure is isolated per tenant, in the walk and now in the relay

The walk wraps **each tenant**, so one tenant's outage costs one tenant.

The relay did not, and that rides along as a correction: `startOutboxRelay`
wrapped its whole sweep in one `catchAll`, so a failure on tenant N abandoned
every tenant after it. Survivable there in theory because another sweep follows
in 15s — except that the likeliest failure is the `IndexOptionsConflict`
`ensureOutboxIndexes` documents, which recurs on **every** pass, so the tenants
behind it would never drain again while the relay went on looking healthy. The
pass is now an exported `sweepTenantOutboxes`, which is also what makes "one
tenant's failure does not take the next tenant's" a test rather than a comment.

## Consequences

- **A fresh `dev:reset` reaches a populated storefront with nobody opening a
  form**, which is what [#148](https://github.com/r10c-technologies/r10c/issues/148)
  needs before a live-profile storefront e2e can assert anything true.
- **Running it twice changes nothing.** Identical stored moment → identical event
  id → `duplicate`. The second run reports `alreadyAnnounced` and writes nothing.
- ⚠️ **A projection lost while tenant storage survives is still not
  rebuildable.** Named above; the missing piece is an operator-triggered force
  and the authorization surface it needs.
- ⚠️ **Nothing still ties a quarantined `catalog.*` entry back to its offering
  _before_ a rebuild runs.** ADR 0048's reconciliation residual stands: the walk
  repairs such an entry at the next boot, and until then the operator-facing
  symptom is a storefront that disagrees with a vendor's screen.
- **The walk is unbounded in wall-clock time.** It is sequential and paged, so it
  holds nothing large in memory, but a fleet with many tenants makes a long boot
  task. It is forked, so nothing waits on it.
- **An offering carrying no moment is skipped, not guessed at.** That is the
  right answer and it means a lab that predates the stamped seed stays empty until
  a reset.
- **The register is untouched.** No new event name, no new route, no new
  upstream, no slice promotion — this walk publishes what the transition route
  already publishes, through the outbox the relay already drains.
