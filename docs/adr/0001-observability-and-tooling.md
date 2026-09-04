# 1. Observability & platform tooling

- Status: Accepted
- Date: 2026-07-22
- Revised: 2026-09-01 — the metrics half of this record is still unbuilt, and the
  first metric set is named. See "Metrics" below. The pipeline decision is
  unchanged.
- Revised: 2026-09-04 — the metric pipeline is built (#185): a `MeterProvider`
  and an OTLP metric exporter now sit beside the tracer. What remains is the
  instrumentation (#186). The destination decided below never changed.

## Context

The platform had **no observability**: no logs pipeline, no metrics, no tracing —
only Effect's per-request `HttpMiddleware.logger` writing to stdout. We need to
plan the production monitoring stack and ship a first working slice.

Four requirements drive the design: collect logs from every frontend/backend
service; Real User Monitoring (RUM) for the frontends; product event tracking +
A/B testing; and OpenTelemetry-based tracing/metrics. Two infrastructure choices
were already fixed by the team (MongoDB Atlas, a Kubernetes cluster); the cloud
provider was left open during design and then settled.

## Decision

### Cloud & storage (locked)

- **Google Cloud / GKE**, with the cluster co-located in the same region as
  **MongoDB Atlas** (VPC peering / Private Endpoint, no NAT egress). Managed
  Cloud SQL Postgres backs Zitadel + config-service. Redis/RabbitMQ/Zitadel run
  in-cluster.
- The cloud choice does **not** drive observability: we instrument once against
  **OTLP** (vendor-neutral) so the backend is swappable.

### Observability pipeline

- **OTLP everywhere → OpenTelemetry Collector → Grafana Cloud** (Loki logs /
  Mimir metrics / Tempo traces / Faro RUM), hosted in the same GCP region.
  Collector topology in a cluster: a DaemonSet agent (filelog tail + OTLP
  receive) + a Deployment gateway (tail-sampling, batch, PII scrub, egress).
- **GCP Cloud Logging/Monitoring** is the free **infra floor** only (auto on
  GKE), not the app-observability backend — it can't do RUM and would lock the
  query languages to GCP.
- **Do not wrap OpenTelemetry in an Entifix `Context.Tag` port** — it is a
  cross-cutting, already-vendor-neutral layer. (The product-analytics SDK, which
  is a real swappable vendor, _is_ wrapped — see below.)

### Browser RUM

- Browser telemetry posts to a same-origin **`/api/telemetry` proxy** in each
  Next app (a telemetry BFF), not to a public Collector. Same-origin means auth
  for free (session cookie), a scrub choke point in code we own, and no new
  public surface. The route stays a thin, rate-limited, session-enriching OTLP
  forwarder (body cap, Redis rate-limit, zod validation, never trust
  browser-supplied identity). _(Deferred to a later iteration.)_

### Logging package

- **`@r10c/entifix-ts-tooling`** — a framework-free leaf built on the OTel
  standard (not an Effect wrap, so it serves Effect backends, the Next server,
  and the browser from one package). Two independent subpath modules:
  `/logging` (leveled `createLogger` over a pluggable `LogSink`; stamps service,
  `SeverityNumber`, and — when a span is active — `trace_id`/`span_id`) and
  `/tracking` (the `Tracker` interface + `NoopTracker`).
- Sinks pick the transport: `makeStdoutJsonSink` (backend/prod → Collector
  filelog), `makeOtlpHttpLogSink` (dev → otel-lgtm), the `LogSink` interface
  (browser `/api/telemetry`, tests). One canonical `redact` list masks secrets
  before any sink.
- Log level + sink resolve **per service from config-service** (`logging.level`,
  `logging.sink`, `otel.endpoint`).

### Product analytics + A/B

- **PostHog** (analytics + feature flags + experiments in one SDK; generous free
  tier). Adapter package **`@r10c/entifix-ts-posthog-client`**
  (`posthog-node` + `posthog-js`/`browser`) implements the `Tracker` port,
  provided per environment behind `TrackerTag` (Effect `Context.Tag`, business
  layer) — the same adapter-per-environment shape as REST vs Mongo behind
  `EntityRepositoryTag`. **The browser runs Effect DI too**, so one seam serves
  both tiers. Product events are a **separate concern from logs** (opposite
  identity + retention policy) and fan out to a different backend — never into
  Loki/OTel.

### Composition

- Logging/tracking are wired at the **existing composition roots**, never in the
  shared packages: the service `AppLayer` (backend) and the Next
  `AdaptersProvider` / server root (frontend, two sub-roots for the split
  runtimes). No new mechanism — two more Tags at wiring points that exist.

### Local development

- **`grafana/otel-lgtm`** (Collector + Loki + Grafana + Tempo + Prometheus) runs
  in `infra/local` (minikube) as the local mirror of Grafana Cloud — same
  query languages, so what is validated locally ports to production. Dev apps run
  on the host (no pod to tail), so they export **OTLP straight to otel-lgtm**;
  the stdout→filelog path is a cluster-only concern.

## What shipped in iteration 1

- `@r10c/entifix-ts-tooling` (`/logging` real, `/tracking` interface + stub).
- `@r10c/entifix-ts-posthog-client` (adapter built + tested, not yet wired into a
  running app).
- `grafana/otel-lgtm` in `infra/local` (NodePorts 30000 Grafana, 30317/30318
  OTLP); config-service seed rows for `marketplace-admin-service`.
- `marketplace-admin-service` dogfood: OTel tracing (`@effect/opentelemetry`
  NodeSdk) + the tooling logger replacing Effect's default logger, both from
  config. A mock-profile e2e asserts trace-correlated log capture; a live run
  confirmed request spans in Tempo and request logs in Loki with the trace id in
  the OTLP payload.

Notable gotchas found and fixed:

- `@opentelemetry/api`'s `module` export entry uses extensionless imports Node's
  loader rejects; the test config drops the `module` resolve condition and
  inlines the OTel SDK packages.
- `@effect/opentelemetry` doesn't register an OTel context manager, so the tooling
  logger's active-span lookup would be empty — the service registers
  `AsyncLocalStorageContextManager`.
- `NodeRuntime.runMain` swaps `defaultLogger` for `prettyLoggerDefault` before the
  app layer runs, so `Logger.replace(defaultLogger, …)` finds nothing; `makeService`
  now passes `disablePrettyLogger: true`.

## Metrics

> Added 2026-09-01 as "metrics are still deferred"; rewritten 2026-09-04 when the
> pipeline landed. The decision below is unchanged — this records how far the
> implementation actually got, because the gap was easy to miss from the outside
> and its absence had no symptom at the call site.

For a year of this record's life `observability.ts` built `NodeSdk` with an
`OTLPTraceExporter` and nothing else. There was no `MeterProvider` and no metric
exporter, so logs and traces reached the Collector and **metrics had no path at
all** — a service could call `Metric.*`, the counter incremented, the program
was correct, and the value went nowhere.

`observability.ts` now passes a `PeriodicExportingMetricReader` over an
`OTLPMetricExporter` into the same `NodeSdk.layer` that carries the span
processor. One layer for both signals, deliberately: `NodeSdk` builds the OTel
`Resource` once, so a metric and the span it belongs beside cannot disagree
about `service.name`. **No producer is written here** — `NodeSdk` wires a
reader through `@effect/opentelemetry`'s `Metrics.layer`, whose `MetricProducer`
reads _Effect's own metric registry_, so `Metric.counter(…)` at any call site is
exported and a domain counter stays one line where it is incremented.

Two properties of that wiring are worth stating because neither is visible from
a call site. The OTLP **endpoint is optional**: with none, the layer builds and
runs, logs fall back to the stdout sink, and neither exporter exists. It used to
be a required configuration read, which meant an unreachable telemetry
destination took the _service_ down — the wrong trade for a signal that is not
on the request path. A **blank** endpoint counts as absent for the same reason:
config-service's operator CRUD writes empty strings, and `''` taken literally
aims the exporters at a relative `/v1/traces` and `/v1/metrics` that resolve
against nothing — a service that exports nothing while reading as configured. And the export interval is `otel.metricIntervalMs` in
config-service, optional with a 60s default, because that seed is
`ON CONFLICT DO NOTHING` and so reaches an existing database only through a
`dev:reset`.

The first metric set is still unbuilt; it is #186's scope:

- **Bus** — events published, consumed, failed and quarantined, by event name and
  subscription.
- **Outbox** — pending depth, and the **age of the oldest unsent entry**. That
  second one is the metric that makes a stuck relay visible. An entry that can
  never publish no longer blocks the ones behind it — #179 gave the relay a
  ceiling, so it is quarantined and skipped
  ([ADR 0030](0030-failure-retry-and-quarantine-on-the-bus.md)) — but it is
  reported only as a log line until it is counted, so how _many_ are stuck is
  still unanswerable.
- **Transactions** — count by state, so `STALE` is something a dashboard shows
  rather than something a poll discovers.

## Deferred

The `/api/telemetry` browser proxy + Faro RUM;
wiring `TrackerTag`/PostHog into a running app; fleet-wide rollout; the OTel
Collector DaemonSet/gateway (prod only); the Grafana Cloud connection; and
Phase-2 self-hosting of the storage backend (SigNoz or Grafana LGTM on GCS) —
the Collector seam keeps that a config-only swap, so instrumentation never
changes.
