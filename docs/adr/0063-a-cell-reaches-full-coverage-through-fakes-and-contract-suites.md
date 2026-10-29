# 63. A cell reaches full coverage through fakes and contract suites

- Status: Accepted
- Date: 2026-10-25
- Revised: 2026-10-26 — the suites were written (#427): where a suite and its double live, what counts as a port, and the two limits the build found
- Area: platform
- Read when: writing the spec for a `mongo`, `sql`, `redis` or `http` cell, or a cell misses the 100% gate — fake the driver one level below the adapter, run every port's contract suite, and prove a race against the live lab
- Revised: 2026-10-28 by [ADR 0064](0064-failures-reach-the-slice-shell.md) — `describeFailureContract` from `@entifix/testing-unit` joins every cell's suite: each failure a package defines is registered, categorised, and round-trips through its problem body without a stack
- Revised: 2026-10-28 by [ADR 0065](0065-use-case-resolution-and-the-routing-slip.md) — a use case with variants runs its contract suite once per variant through `forEachVariant`

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
  - **Where it lives:** the business package's `./testing` subpath
    (`src/testing/`), with `vitest` as an optional peer, the way
    `@entifix/testing-unit` ships entifix's. The suite is spec-only code, so
    it never reaches the package's `.` entry.
  - **The double moves with its suite.** Each `./testing` subpath also exports
    the port's in-memory (or scripted) double, and the business package's own
    spec runs the suite against it. So the double an HTTP cell's spec uses is
    held to the same rules as the store it stands in for, and the suite file
    is covered where it is declared. An HTTP spec that scripts a race or a
    failure the port cannot express keeps its stub; it is not standing in
    for an implementation.
  - **What a suite observes.** A port's own methods first. Where the port is
    write-only (a projection's `apply`), the subject is made with a read of
    its effect, such as whether an offering is listed. Where the port talks
    to a peer over HTTP (the saga starter, the price reader, the identity
    provider), the subject is made over a scripted peer.
  - **What counts as a port.** A `Context.Service` whose implementation lives
    outside the package that declares it. Not a port, so no suite: an input
    tag (`*InputTag`), a configuration value (`CancelWindowSeconds`), a
    request-scoped value (`SessionIdTag`, `PrincipalTag`), and a second name
    for entifix's own port (`OfferingPriceRepositoryTag` is an
    `EntityRepository`, held to entifix's repository suite). A port whose
    only implementation is a composition in the same package, with its own
    spec (`makeSessionIdentityProvider`), has nothing to hold to anything
    else.
  - **Two limits the build found.** The SQL driver fake scripts statements
    rather than holding rows, so a SQL subject is made with at most one stored
    row and the suite asks about one write at a time. The Mongo fakes can
    model atomicity but never interleaving, so no suite asserts a race; each
    says which race it leaves to the live pass.
- **An HTTP cell is tested in process**, through `serveRoutes` from
  `@r10c/testing-http` — Effect's own web handler, with no port and no runtime
  — over in-memory doubles of its ports (`makeInMemoryUnitOfWork`, an in-memory
  repository factory). Not the framework's `serveTestService`: that boots a
  whole service, and a cell's boundary rule bans the runtime half in specs as
  in source, rightly, because a cell must not choose how it is hosted. It never
  imports a persistence cell, in its spec any more than in its source.
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
