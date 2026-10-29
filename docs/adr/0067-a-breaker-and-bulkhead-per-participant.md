# 67. A circuit breaker and a bulkhead per participant

- Status: Accepted
- Date: 2026-10-28
- Area: messaging
- Read when: a participant is down and its callers pile up, or a consumer quarantines during an outage — one breaker and bulkhead per participant per process, every dial a config row

## Context

Nothing isolates a failing participant. When stock-service is down, every
checkout's reservation call waits out its timeout, every redelivered message
for it nacks until its ceiling, and the outage turns into quarantined messages
and slow failures everywhere at once. The retry budget
([entifix ADR 0014](https://github.com/r10c-technologies/entifix/blob/v0.11.0/docs/adr/0014-retry-once-at-the-layer-above-under-a-budget.md))
bounds what retries add; it does not stop first attempts.
[entifix ADR 0017](https://github.com/r10c-technologies/entifix/blob/v0.11.0/docs/adr/0017-circuit-breaker-and-bulkhead-ports.md)
gives the ports and the in-memory engines.

## Decision

### Per process, per participant

Every participant a flow calls gets one breaker and one bulkhead in each
process that calls it, keyed by participant (optionally by route). A
per-process breaker converges within a window and needs no shared store.

### The breaker

States `CLOSED`, `OPEN`, `HALF_OPEN`, plus `FORCED_OPEN` and `DISABLED` for an
operator. It records technical failures except `protocol`, and trips at once on
a `429` or `503` carrying `Retry-After`.

| Dial (group `breaker`) | Default | Meaning                                      |
| ---------------------- | ------- | -------------------------------------------- |
| `windowType`           | `count` | `count` or `time`                            |
| `windowSize`           | 20      | calls (or seconds) the rate is measured over |
| `minimumCalls`         | 5       | below this, the breaker never trips          |
| `failureRateThreshold` | 50      | percent of failures that opens it            |
| `slowCallThresholdMs`  | 2000    | a call slower than this counts as slow       |
| `slowCallRate`         | 80      | percent of slow calls that opens it          |
| `waitInOpenMs`         | 10000   | how long it stays open before probing        |
| `halfOpenPermits`      | 3       | probe calls allowed while half-open          |
| `bulkheadPermits`      | 16      | concurrent calls per participant             |
| `attemptTimeoutMs`     | 5000    | per-attempt bound                            |
| `stepBoundMs`          | 60000   | whole-step bound, past which a flow strands  |

### What an open breaker means, by phase

- **Before the commit point**: the call fails fast as `unavailable`, and the
  flow compensates.
- **At the pivot**: the dispatch is refused, so no money moves.
- **After it**: the step suspends and resumes when the breaker half-opens; past
  `stepBoundMs` the flow strands with `flow.suspended`, and that alerts.

A full bulkhead is `exhausted`. A consumer whose handler calls a participant
pauses its prefetch while that participant's breaker is open, so an outage
leaves messages waiting on the queue rather than in quarantine.

## Consequences

- An outage fails fast before the commit point and waits after it, instead of
  timing out everywhere.
- **Checks:** every dial above is seeded in config-service and a config-seed
  spec asserts it; the `/engine` subpath stays banned from cells; the slices
  register caps a delivery's attempts at what the breaker allows.
- **Revises** [ADR 0030](0030-failure-retry-and-quarantine-on-the-bus.md) (a
  consumer pauses on an open breaker) and
  [ADR 0001](0001-observability-and-tooling.md) (breaker state, transitions and
  rejections are metrics with a Grafana panel) in place.
- Built in wave 3 (#462).
