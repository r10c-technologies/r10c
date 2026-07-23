# @r10c/entifix-ts-tooling

Framework-free platform tooling built on the OpenTelemetry standard. One leaf
package, two independent modules (no shared interface between them):

- **`@r10c/entifix-ts-tooling/logging`** — a leveled logging facade
  (`createLogger`) over a pluggable `LogSink`. Stamps every record with the
  service name, an OTel `SeverityNumber`, and — when a span is active — the
  active `trace_id`/`span_id`, so logs join their traces in Grafana. Ships three
  sinks: `makeStdoutJsonSink` (backend/prod → tailed by the Collector's filelog
  receiver), `makeOtlpHttpLogSink` (dev → OTLP to `grafana/otel-lgtm`), and the
  `LogSink` interface for anything else (browser `/api/telemetry`, test doubles).
  `redactRecord` masks the canonical secret keys before any sink sees them.

- **`@r10c/entifix-ts-tooling/tracking`** — the product-analytics facade: the
  `Tracker` interface (`track`/`identify`/`flag`) plus a `NoopTracker`. The real
  vendor adapter lives in `@r10c/entifix-ts-posthog-client`; `Tracker` is
  provided per environment behind `TrackerTag` (Effect `Context.Tag`).

Why framework-free (not an Effect wrap): the browser and Next server are not
Effect, so only an OTel-standard facade can serve every runtime from one package.
Effect backends adapt it in ~10 lines at their composition root (`Logger.replace`).

The package depends only on `@opentelemetry/api`.
