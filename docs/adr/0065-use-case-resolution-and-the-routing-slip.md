# 65. Use-case resolution and the routing slip in r10c: who declares fragments, where the catalog lives, what CI enumerates

- Status: Accepted
- Date: 2026-10-28
- Area: messaging
- Read when: adding a step to a flow, a variant to a use case, or a narrowing to a read — a domain declares its own fragments, and CI enumerates every combination a recipe can produce

## Context

r10c's flows are whole definitions in the coordinator
(`packages/shells/effect/transaction/src/sagas/checkout.saga.ts`,
`cancellation.saga.ts`). They live there because a `business:domain` package
may not import another, so the only place allowed to name stock, order and
payment together was the shell that dispatches them. Three costs followed:

- **A participant's contract is invisible until it fails live.** The path
  templates in the saga are the only statement of what stock's reservation or
  payment's capture takes and answers.
- **The register drifted.** The transaction slice's `dependantAPIs`
  (`tools/slices/src/slices/transaction.slice.ts`) is hand-kept beside the
  steps it dispatches, and no check ties the two together.
- **Read narrowing is written twice by hand** — order's `OrderScope` and
  settlement's scope — each wired through a `scope` callback that casts the
  principal ([ADR 0053](0053-scoping-a-platform-plane-read-to-its-caller.md)).

[entifix ADR 0015](https://github.com/r10c-technologies/entifix/blob/v0.11.0/docs/adr/0015-composed-flows-and-use-case-resolution.md)
gives the mechanism: fragments, a pinned routing slip, a pure validator, ordered
predicates over a verified context. This record says how r10c lays it out.

## Decision

### Each domain declares its own fragments

A `business:domain` package that takes part in a flow declares its fragments in
`src/fragments/` and exports them from `.`: `stock.reserve@1` beside stock's
reservation use case, `payment.capture@1` beside payment's. A fragment's
contract is the Schema of the use case's input and output and the domain's own
failure union, so the contract is stated where the use case is.

**No domain imports another to take part.** A recipe references fragments by
`id@n` strings, and the only code that holds them all is the catalog below.

### The catalog and the recipes live in one shell

`@r10c/shells-effect-flow-catalog` (`layer:shell`, `shell:base`,
`scope:shared`) assembles every fragment into `flowCatalog` and holds the
recipes — `checkout` and `cancellation` today. It is a base shell because two
kinds of consumer need it: transaction-service, which composes and starts
flows, and every service whose `$metadata` reports a flow-backed verb. A domain
shell may import a base shell; a base shell imports no domain shell.

### A call is a public path, and the register agrees with it

A fragment's `call` and `compensation` are the participant's public paths. The
shell's spec emits `flow-catalog.json`, and `@r10c/slices` asserts — without
importing the packages that declare the fragments — that every call is in its
participant's `exposedAPIs` and in the transaction slice's `dependantAPIs`. The
hand-kept list becomes a checked one.

### CI enumerates every combination

`catalog.spec.ts` runs `expectAllCompositionsValid` over each recipe × every
entitlement subset × every payment method × one and two vendors. A golden
`catalog-snapshot.json` holds each fragment's fingerprint, so a contract change
without a version bump fails the snapshot before it fails a flow.

### Narrowing is a resolver, not a callback

A read's narrowing is `NarrowingRules`: operator unscoped, a vendor to their
organization, a buyer to their party, everyone else nothing. The by-id read is a
load of the narrowing plus id equality — there is no second, in-memory
`includes` to drift from the list.

### A suite per variant

Every `defineVariants(` has a spec that runs its use case's contract through
`forEachVariant`, and no `When(` predicate reads a request-input identifier;
`@r10c/conventions` plants both.

## Consequences

- A participant's contract is declared and fingerprinted beside its use case,
  and changing it means bumping its version.
- The checks this record names have owners: the fragments are #457, the catalog,
  the enumeration and the register checks are #458, and the narrowings and
  `$metadata` are #459.
- The coordinator's `sagas/*.saga.ts` stay until the flow engine replaces them
  (#486, #487); until then the recipes reproduce them step for step, and
  the transaction shell's `recipes.spec.ts` fails the build when they part.
- **Revises in place:** [ADR 0026](0026-the-use-case-descriptor-and-served-entity-metadata.md)
  (`$metadata.composition`, and an unreachable verb is omitted),
  [ADR 0053](0053-scoping-a-platform-plane-read-to-its-caller.md) (the scope is
  a resolver narrowing, and the by-id read is a narrowed load), and
  [ADR 0063](0063-a-cell-reaches-full-coverage-through-fakes-and-contract-suites.md)
  (a suite per variant).
