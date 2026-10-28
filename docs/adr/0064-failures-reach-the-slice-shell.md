# 64. Failures travel typed to the slice shell, answer one problem body, and are logged only there

- Status: Accepted
- Date: 2026-10-28
- Area: platform
- Read when: adding a refusal, a status mapping, an error body or a log call, composing a service, or about to write `Effect.retry` in a consumer — every `-service` answers `application/problem+json` and nothing else, `code` is the `errors` catalog key, business and implementation never log, and the slice's shell is the one place that decides status, retry and logging

## Context

entifix 0.10.0 replaced its `EntifixError` class tree with typed failures
([entifix ADR 0013](https://github.com/r10c-technologies/entifix/blob/v0.10.0/docs/adr/0013-failures-are-typed-values-decided-at-the-shell.md))
and said who retries ([entifix ADR 0014](https://github.com/r10c-technologies/entifix/blob/v0.10.0/docs/adr/0014-retry-once-at-the-layer-above-under-a-budget.md)).
r10c's own records still encoded the old model in five places:

- [ADR 0003](0003-i18n-mandatory.md) rejected a `code` on the error itself and
  had the rest client carry it on `EntifixError.details`.
- [ADR 0030](0030-failure-retry-and-quarantine-on-the-bus.md) defined the bus's
  failure classes by class — `EntifixBuildError` was poison.
- [ADR 0001](0001-observability-and-tooling.md) set log levels with no owner
  for the policy, and business code and cells logged where they failed.
- [ADR 0060](0060-the-implementation-layer-cells.md) kept transaction-service's
  coordinator in its app, the one exception to "apps only mount".
- [ADR 0062](0062-categories-form-a-tree.md) tabled refusals as `{ error, code }`
  bodies.

And composition had no home: each `apps/*-service/src/{routes,mongo}.ts`
assembled its cells, relays, consumers and sweeps by hand, so the decision of
what a failure means was made in ten apps, ten slightly different ways.

## Decision

### One wire

Every `-service` answers a failure as `application/problem+json`
([RFC 9457](https://www.rfc-editor.org/rfc/rfc9457)) and nothing else. `code`
sits at the top level and **is** the `errors` catalog key; the browser decodes
the body back into the failure that was sent and translates `errors:<code>`,
interpolating the failure's own fields.

### Who decides what

- **Business packages** declare their refusals and their ports' failures, through
  entifix's `Failure.<category>` definers. A code is permanent: renaming one is a
  new failure.
- **Cells** translate — a driver error into a store failure, a request into a
  call — and never decide a status, a retry or a log line.
- **The slice's Effect shell** owns all of that: `respond` and the status
  overrides, the fleet `FailurePolicy` extended per slice, the log table, the
  retry reactions, and every daemon fork site — relays, consumers, sweeps — with
  the outcome sink it hands each one.
- **Apps only mount**: `main.ts`, configuration and seed data, and the one shell
  their slice has.

### One shell per slice

`@r10c/shells-effect-<slice>`, under `packages/shells/effect/`:

- `shell:domain` for a slice that owns a domain;
- `shell:platform` for one that declares none (`transaction`, and later
  `realtime`);
- `@r10c/shells-effect-service` becomes `shell:base`.

A domain or platform shell may depend on `shell:base` and never on another
shell; `shell:base` depends on neither. The transaction coordinator — the saga
runner, the dispatcher and the sweeps — moves into `shells-effect-transaction`,
because a shell may compose `@entifix/transactions/engine` where a cell may not.
ADR 0060's app exception ends here.

### One retry layer

Following entifix ADR 0014: only the coordinator retries a participant, under
the budget, never a business failure. A consumer's only retry is redelivery. Its
`maxAttempts` stays a per-subscription dial, and the slices register asserts
every subscription's `maxAttempts` is at most the **fleet delivery budget of
5** — since a consumer handler never retries in-process, attempts × deliveries
is the delivery limit itself. Retry dials are config-service rows, group
`retry`, per service.

### Nobody below the shell logs

`Effect.log*`, `Effect.annotateLogs`, `Effect.withLogSpan` and `console.*` are
banned in `packages/business/**` and `packages/implementation/**`. A use case or
a cell returns an outcome; the shell logs it with `code`, `category` and
`traceId`, never `String(error)`.

### What enforces it

Each rule is a check, not a sentence
([ADR 0046](0046-conventions-are-checked-not-stated.md)):

- `pnpm nx test @r10c/i18n-check` reads the failure registry: every registered
  code has an `errors` key in every locale, and every key a registered code
  (#445).
- The `shell:*` tag constraints in `eslint.config.mjs`, with planted pairs in
  `@r10c/conventions`, and `@r10c/docs-check` asserting each shell's tags and
  that each deployment imports exactly one shell (#446, #447).
- The `slices` spec's delivery-budget assertion and the lint ban on a retry in
  a consumer (#448).
- The no-logging rule with a planted violation (#449).
- The bans on hand-written error bodies and `instanceof` on a failure, once every
  slice has migrated (#491).

## Consequences

- A refusal a service writes by hand — `{ error, code }` — decodes in the browser
  as a protocol failure and shows generic copy until its slice migrates in wave
  3. Accepted for the length of the migration rather than shipping a second
  decoder.
- The shells are ten new packages, each held to the coverage gate. The apps
  shrink to their entry points, which is the point: the place a reader looks for
  what a failure means is the same place in every service.
- A business package that needs to say something about its own work says it as
  a return value. That makes some use-case signatures longer, and makes every
  one of those outcomes testable without capturing logs.
- Moving the coordinator into a shell is churn the workflow engine will undo in
  wave 4. It is still cheaper than an exception to "apps only mount" that every
  later check would have to carve around.
