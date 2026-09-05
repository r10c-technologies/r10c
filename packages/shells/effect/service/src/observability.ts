import { NodeSdk } from '@effect/opentelemetry';
import { context } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  type MetricReader,
  PeriodicExportingMetricReader,
  type ResourceMetrics,
} from '@opentelemetry/sdk-metrics';
import {
  BatchSpanProcessor,
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import type {
  ConfigurationClient,
  EntifixBuildError,
} from '@r10c/entifix-ts-core';
import {
  type Attributes,
  createLogger,
  type Logger as ToolingLogger,
  type LogLevel,
  type LogRecord,
  type LogSink,
  makeOtlpHttpLogSink,
  makeStdoutJsonSink,
} from '@r10c/entifix-ts-tooling/logging';
import { Effect, HashMap, Layer, Logger } from 'effect';

/** Resolved observability settings (from config-service `logging.*`/`otel.*`). */
export interface ObservabilityConfig {
  readonly serviceName: string;
  readonly level: LogLevel;
  /** `otlp` in dev (ship straight to otel-lgtm), `stdout` in a cluster (filelog). */
  readonly sink: 'stdout' | 'otlp';
  /**
   * OTLP base URL; `/v1/traces`, `/v1/logs` and `/v1/metrics` are appended.
   *
   * **Optional, and that is the boot guarantee**: with no endpoint the service
   * still starts — logs fall back to the stdout sink and neither exporter is
   * built. It used to be a required `getString`, so a fleet whose
   * `otel.endpoint` row was missing failed to boot at all rather than running
   * without telemetry, which is the wrong trade for a signal that is not on the
   * request path.
   */
  readonly otelEndpoint?: string | undefined;
  /**
   * How often the metric reader exports, in milliseconds. Config rather than a
   * constant because it is a real operational dial (a shorter interval buys
   * resolution with cardinality-independent request volume), and optional
   * because a fleet whose seed predates the key should not fail to boot over an
   * export interval. (Optional for that reason alone: config-service reconciles
   * `SEED_ROWS` per row on every boot, so a *new* key does reach an existing
   * Postgres — `ON CONFLICT DO NOTHING` declines to overwrite an operator's
   * changed *value*, which is the case that needs a `dev:reset`.)
   */
  readonly metricIntervalMs?: number | undefined;
}

/** Export interval used when `otel.metricIntervalMs` is unset. */
const DEFAULT_METRIC_INTERVAL_MS = 60_000;

/** The in-memory reader's interval — long enough that only `forceFlush` collects. */
const ONE_HOUR_MS = 3_600_000;

/**
 * `@effect/opentelemetry` manages its own span tree but does not register an
 * OpenTelemetry context manager, so `@opentelemetry/api`'s active-span lookup
 * (which the tooling logger uses to stamp `trace_id`) would stay empty. Register
 * the AsyncLocalStorage manager once so the active span propagates and logs
 * correlate to their traces. Idempotent — `setGlobalContextManager` no-ops if a
 * manager is already registered (e.g. across test boots in one process).
 */
let contextManagerReady = false;
const ensureContextManager = (): void => {
  if (!contextManagerReady) {
    context.setGlobalContextManager(
      new AsyncLocalStorageContextManager().enable(),
    );
    contextManagerReady = true;
  }
};

/**
 * The OTLP base URL, or `undefined` when there is nowhere to export.
 *
 * A **blank** endpoint counts as absent, not as a base URL. config-service's
 * operator CRUD writes empty strings, so `''` is reachable in practice — and
 * taken literally it builds exporters aimed at the relative `/v1/traces` and
 * `/v1/metrics`, which resolve against nothing, fail every export, and look
 * from the call site exactly like a service that is simply quiet.
 */
const resolveEndpoint = (raw: string | undefined): string | undefined => {
  const trimmed = raw?.trim();
  return trimmed === undefined || trimmed === '' ? undefined : trimmed;
};

const makeSink = (
  config: ObservabilityConfig,
  endpoint: string | undefined,
): LogSink =>
  config.sink === 'otlp' && endpoint !== undefined
    ? makeOtlpHttpLogSink({
        endpoint,
        serviceName: config.serviceName,
        // Flush on a short interval too, so a quiet service's logs reach the
        // Collector promptly instead of waiting for a full batch.
        flushIntervalMs: 2000,
        onError: error =>
          process.stderr.write(
            `[otlp-log-sink] export failed: ${String(error)}\n`,
          ),
      })
    : makeStdoutJsonSink();

/**
 * Effect's `LogLevel.label` mapped onto the four levels the tooling logger has.
 *
 * ⚠️ **The labels are upper case** — `"TRACE" | "DEBUG" | "INFO" | "WARN" |
 * "ERROR" | "FATAL" | "ALL" | "NONE"`, as `effect/LogLevel` declares them. This
 * switch used to read `'Trace'`/`'Debug'`/`'Warning'`/`'Error'`/`'Fatal'`, so
 * **no case could ever match** and every log in the service fell through to
 * `default` and was emitted at `info`. Measured in Loki: an `Effect.logError`
 * arrived as `severity_text: INFO`, `severity_number: 9`, which makes an error
 * invisible to every level-based alert and dashboard while still appearing in
 * the log — the failure mode that reads as "we have no errors".
 *
 * `'WARNING'` is deliberately absent: Effect's label is `WARN`, and adding the
 * other spelling would suggest one of them is live when only this one is.
 */
const toToolingLevel = (label: string): LogLevel => {
  switch (label) {
    case 'TRACE':
    case 'DEBUG':
      return 'debug';
    case 'WARN':
      return 'warn';
    case 'ERROR':
    case 'FATAL':
      return 'error';
    default:
      return 'info';
  }
};

/**
 * `Effect.annotateLogs`' entries flattened into tooling `Attributes`.
 *
 * The annotations arrive as a `HashMap<string, unknown>` and the attribute
 * values are a closed scalar set, so anything else is stringified rather than
 * dropped — an annotation that reaches a sink as `[object Object]` is still
 * more use than one that silently is not there.
 */
const toAttributes = (
  annotations: HashMap.HashMap<string, unknown>,
): Attributes =>
  Object.fromEntries(
    Array.from(HashMap.entries(annotations), ([key, value]) => [
      key,
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value === null
        ? value
        : String(value),
    ]),
  );

const messageToString = (message: unknown): string =>
  Array.isArray(message)
    ? message.map(part => String(part)).join(' ')
    : String(message);

/**
 * An Effect `Logger` that forwards every Effect log (including the HTTP request
 * logs from `HttpMiddleware.logger`) to the tooling logger — so the whole
 * service logs through one structured, trace-correlated pipeline.
 *
 * **`annotations` are forwarded**, and used not to be: they were destructured
 * away, so every `Effect.annotateLogs` in every service was discarded before it
 * reached a sink. That made the annotated fields the outbox relay and the
 * transaction engine attach — the tenant database, the event id, the
 * transaction id, the rollback's own error — unqueryable, while the comments
 * beside them said they were structured fields in Loki. Measured: the records
 * arrived carrying the message and nothing else.
 *
 * `error` is called through its own arm because the tooling `Logger` gives it a
 * different signature — `(message, error?, attributes?)` — so passing the
 * attributes positionally as the second argument would file them as the *cause*
 * and lose them again.
 */
const makeEffectLogger = (
  logger: ToolingLogger,
): Logger.Logger<unknown, void> =>
  Logger.make(({ logLevel, message, annotations }) => {
    const level = toToolingLevel(logLevel.label);
    const text = messageToString(message);
    const attributes = toAttributes(annotations);

    if (level === 'error') {
      logger.error(text, undefined, attributes);
      return;
    }
    logger[level](text, attributes);
  });

/** Lower-level inputs to {@link makeObservabilityLayerWith}. */
export interface ObservabilityLayerOptions {
  readonly serviceName: string;
  readonly level: LogLevel;
  /** Where log records go (a real sink in prod, an in-memory double in tests). */
  readonly sink: LogSink;
  /**
   * How spans are exported (batch→OTLP in prod, in-memory in tests).
   * Omitted when there is no OTLP endpoint to export to.
   */
  readonly spanProcessor?: SpanProcessor | undefined;
  /**
   * How metrics are exported (periodic→OTLP in prod, in-memory in tests).
   *
   * Injectable for the same reason `spanProcessor` is: a test drives the exact
   * wiring that ships, so — unlike a double that reimplements the composition —
   * it can see `Metrics.layer` failing to register a producer at all.
   */
  readonly metricReader?: MetricReader | undefined;
}

/**
 * The observability composition over explicit sink + span processor: replace
 * Effect's default logger with the tooling-backed one, and stand up the OTel
 * tracer so requests produce spans. Keeping sink/processor injectable lets a
 * test drive the exact same wiring with in-memory exporters (see
 * {@link makeInMemoryObservabilityLayer}), so the correlation the e2e asserts is
 * the correlation that ships.
 */
export const makeObservabilityLayerWith = (
  options: ObservabilityLayerOptions,
) => {
  ensureContextManager();
  const toolingLogger = createLogger({
    service: options.serviceName,
    level: options.level,
    sink: options.sink,
  });
  // Replace Effect's default logger with the tooling logger. The service boot
  // (`makeService`) launches under `runMain` with `disablePrettyLogger: true`,
  // and the e2e boots under `Effect.runFork`; both leave `defaultLogger` in
  // place, so this single replace takes effect in either runtime.
  const effectLogger = makeEffectLogger(toolingLogger);
  const LoggingLayer = Logger.replace(Logger.defaultLogger, effectLogger);
  // One `NodeSdk.layer` for both signals: it builds the OTel `Resource` once,
  // so the spans and the metrics carry the same `service.name` rather than two
  // resources that can disagree. `NodeSdk` degrades an absent `spanProcessor`
  // or `metricReader` to `Layer.empty` on its own (its `isNonEmpty` guard), so
  // the no-endpoint case needs no branch here — it simply exports nothing.
  //
  // The metric half needs no producer of its own: `NodeSdk` wires the reader
  // through `Metrics.layer`, whose `MetricProducer` reads **Effect's own metric
  // registry**. So `Metric.counter(…)` at any call site is exported, and a
  // domain counter stays one line where it is incremented.
  const TelemetryLayer = NodeSdk.layer(() => ({
    resource: { serviceName: options.serviceName },
    spanProcessor: options.spanProcessor,
    metricReader: options.metricReader,
  }));
  return Layer.merge(LoggingLayer, TelemetryLayer);
};

/**
 * The production/dev observability layer: log level + sink and OTLP endpoint
 * come from config-service. Merged into the service `AppLayer`.
 */
export const makeObservabilityLayer = (config: ObservabilityConfig) => {
  const endpoint = resolveEndpoint(config.otelEndpoint);
  return makeObservabilityLayerWith({
    serviceName: config.serviceName,
    level: config.level,
    sink: makeSink(config, endpoint),
    spanProcessor:
      endpoint === undefined
        ? undefined
        : new BatchSpanProcessor(
            new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
          ),
    metricReader:
      endpoint === undefined
        ? undefined
        : new PeriodicExportingMetricReader({
            exporter: new OTLPMetricExporter({
              url: `${endpoint}/v1/metrics`,
            }),
            exportIntervalMillis:
              config.metricIntervalMs ?? DEFAULT_METRIC_INTERVAL_MS,
          }),
  });
};

/** Captured telemetry from {@link makeInMemoryObservabilityLayer}. */
export interface InMemoryObservability {
  readonly layer: ReturnType<typeof makeObservabilityLayerWith>;
  /** Records the (replaced) logger emitted — the e2e asserts on these. */
  readonly logRecords: readonly LogRecord[];
  /** The spans exported so far (used to confirm requests produced traces). */
  readonly getSpans: () => ReadonlyArray<ReadableSpan>;
  /**
   * Forces a metric collection and returns what the exporter then holds.
   *
   * A push reader only exports on its interval, so a test that merely read the
   * exporter would find it empty and could not tell "the producer is not
   * registered" from "the interval has not elapsed".
   */
  readonly collectMetrics: () => Promise<ReadonlyArray<ResourceMetrics>>;
}

/**
 * Test-support: the real observability wiring with in-memory exporters, so an
 * e2e can boot the service and assert that logs are structured and carry the
 * `trace_id` of the request span that produced them.
 */
export const makeInMemoryObservabilityLayer = (
  serviceName: string,
): InMemoryObservability => {
  const logRecords: LogRecord[] = [];
  const spanExporter = new InMemorySpanExporter();
  const metricExporter = new InMemoryMetricExporter(
    AggregationTemporality.CUMULATIVE,
  );
  // A long interval, because the test drives collection explicitly through
  // `collectMetrics`. A short one would export on a timer as well and make the
  // assertions depend on how long the surrounding effect happened to take.
  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: ONE_HOUR_MS,
  });
  const layer = makeObservabilityLayerWith({
    serviceName,
    level: 'debug',
    sink: { emit: record => logRecords.push(record) },
    spanProcessor: new SimpleSpanProcessor(spanExporter),
    metricReader,
  });
  return {
    layer,
    logRecords,
    getSpans: () => spanExporter.getFinishedSpans(),
    collectMetrics: async () => {
      await metricReader.forceFlush();
      return metricExporter.getMetrics();
    },
  };
};

/**
 * The observability layer for a service, read from its own configuration.
 *
 * This is the whole per-service wiring: a composition root yields it and merges
 * the result into its `AppLayer`. It exists because the four reads below were
 * byte-identical in every service that had them, sitting directly above a
 * `makeObservabilityLayer` call that mapped them one-for-one — the same
 * duplication the module itself carried, one level up.
 *
 * `logging.level` and `logging.sink` are **required**: the rows are seeded for
 * every service and reach an existing table on config-service's next boot (the
 * seed reconciles per row and only declines to overwrite a value that is already
 * there), so a missing one is a real misconfiguration and should be loud.
 *
 * `otel.endpoint` and `otel.metricIntervalMs` are **optional**, for two
 * different reasons. The endpoint is what makes telemetry a *degradable*
 * dependency — with none, the service boots and serves, logs to stdout and
 * exports nothing, rather than an unreachable telemetry destination taking the
 * service down. The interval is a dial with a sane default, and requiring it
 * would fail the boot on any fleet whose seed predates it.
 *
 * Takes the {@link ConfigurationClient} port rather than a concrete client, so
 * config-service can pass the store it builds from its **own** SQL rows: it is
 * the one service that cannot fetch its configuration over HTTP, because it is
 * the thing being fetched from.
 */
export const observabilityFromConfiguration = (
  store: ConfigurationClient,
  serviceName: string,
): Effect.Effect<ReturnType<typeof makeObservabilityLayer>, EntifixBuildError> =>
  Effect.gen(function* () {
    const level = yield* store.in('logging').getString('level');
    const sink = yield* store.in('logging').getString('sink');
    const otelEndpoint = yield* store.in('otel').getOptionalString('endpoint');
    const metricIntervalMs = yield* store
      .in('otel')
      .getOptionalNumber('metricIntervalMs');

    return makeObservabilityLayer({
      serviceName,
      level: level as LogLevel,
      // Anything but the explicit `stdout` is the OTLP sink, which is what makes
      // a mistyped value degrade to shipping rather than to silence.
      sink: sink === 'stdout' ? 'stdout' : 'otlp',
      otelEndpoint,
      metricIntervalMs,
    });
  });
