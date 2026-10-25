# 63. A cell reaches full coverage through fakes and contract suites

- Status: Accepted
- Date: 2026-10-25
- Area: platform
- Read when: writing the spec for a `mongo`, `sql`, `redis` or `http` cell, a package under `packages/implementation/` misses the 100% gate, or you are about to add `mongodb-memory-server` or a container to a unit test — the driver is faked one level below the adapter, every port implementation runs its shared contract suite, and a race is proven against the live lab or not at all

## Context

Apps are ungated (`thresholds: false`) and every package inherits 100%. Moving
a service's persistence and routes out of its app and into cells
([ADR 0060](0060-the-implementation-layer-cells.md)) therefore moves code from
"covered by e2e, measured by nothing" to "must be covered line for line" — and
much of that code runs inside Mongo transactions, which need a replica set.

Two ways to get there were on the table: run a real `mongod` in replica-set mode
inside the unit tests (`mongodb-memory-server`), or test the adapter against a
fake of the driver and hold every implementation of a port to one shared suite.
entifix already chose the second for its own adapters, and ships both halves:
`makeFakeMongoDb` in `@entifix/testing-unit/drivers` (which fakes sessions and
explicit transactions, with real rollback) and the `describe*Contract` suites in
`@entifix/testing-unit/contracts`, including `describeUnitOfWorkContract` since
0.7.2. Nothing in r10c imported a contract suite yet.

## Decision

**Fakes and contract suites. No database in a unit test.**

- **A persistence cell is tested against the driver fake**, one level below the
  adapter, so its own code — the filters, the conditional writes, the error
  mapping — actually runs and is measured. Its unit of work is
  `makeMongoUnitOfWork` over the same fake, which is the real adapter code.
- **Every port implementation runs its contract suite.** A cell that implements
  a port also runs that port's `describe*Contract`, so a cell cannot quietly be
  a more forgiving version of the port it implements. A port r10c declares
  itself gets its suite beside the port, in the business package, and the cell
  runs it.
- **An HTTP cell is tested in process**, through `serveTestService`, over
  in-memory doubles of its ports (`makeInMemoryUnitOfWork`, an in-memory
  repository factory). It never imports a persistence cell, in its spec any more
  than in its source.
- **What is pure moves to business and is tested there**: commission
  arithmetic, an order's scope and its cancel capability, an offering's
  lifecycle guard. A rule that needs no store has no reason to be tested
  through one.

**A race is proven live.** The driver fake and the in-memory unit model
atomicity, not isolation: nothing runs concurrently, so a lost update between
two writers is green under them no matter what the code does. Concurrency is
proven by a parallel burst against the lab, as it always was. The burst that
validated entifix's unit of work before release is the example: eight
concurrent units on one document, and six racing for one command id.

The driver connection layers (`MongoClientLayer` and friends) stay outside the
gate, as entifix's do; they bind a socket and branch on nothing.

## Consequences

- No binary download, no container and no replica set in CI's unit stage; a
  cell's spec runs in milliseconds.
- A fake that disagrees with the real driver is a gap the contract suites do
  not close: they hold implementations to each other, not to Mongo. That is
  what the live pass is for, and a disagreement found there is fixed **in the
  fake**, in entifix, so every consumer inherits it.
- A cell whose only honest test is concurrent says so in its spec and carries a
  live check in the pass that ships it.
