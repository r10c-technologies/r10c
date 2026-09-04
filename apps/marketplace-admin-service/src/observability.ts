import { NodeSdk } from '@effect/opentelemetry';
import { context } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import {
  BatchSpanProcessor,
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
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
import { HashMap, Layer, Logger } from 'effect';

/** Resolved observability settings (from config-service `logging.*`/`otel.*`). */
export interface ObservabilityConfig {
  readonly serviceName: string;
  readonly level: LogLevel;
  /** `otlp` in dev (ship straight to otel-lgtm), `stdout` in a cluster (filelog). */
  readonly sink: 'stdout' | 'otlp';
  /** OTLP base URL; `/v1/traces` and `/v1/logs` are appended. */
  readonly otelEndpoint: string;
}

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

const makeSink = (config: ObservabilityConfig): LogSink =>
  config.sink === 'otlp'
    ? makeOtlpHttpLogSink({
        endpoint: config.otelEndpoint,
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
  /** How spans are exported (batch→OTLP in prod, in-memory in tests). */
  readonly spanProcessor: SpanProcessor;
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
  const TracingLayer = NodeSdk.layer(() => ({
    resource: { serviceName: options.serviceName },
    spanProcessor: options.spanProcessor,
  }));
  return Layer.merge(LoggingLayer, TracingLayer);
};

/**
 * The production/dev observability layer: log level + sink and OTLP endpoint
 * come from config-service. Merged into the service `AppLayer`.
 */
export const makeObservabilityLayer = (config: ObservabilityConfig) =>
  makeObservabilityLayerWith({
    serviceName: config.serviceName,
    level: config.level,
    sink: makeSink(config),
    spanProcessor: new BatchSpanProcessor(
      new OTLPTraceExporter({ url: `${config.otelEndpoint}/v1/traces` }),
    ),
  });

/** Captured telemetry from {@link makeInMemoryObservabilityLayer}. */
export interface InMemoryObservability {
  readonly layer: ReturnType<typeof makeObservabilityLayerWith>;
  /** Records the (replaced) logger emitted — the e2e asserts on these. */
  readonly logRecords: readonly LogRecord[];
  /** The spans exported so far (used to confirm requests produced traces). */
  readonly getSpans: () => ReadonlyArray<ReadableSpan>;
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
  const layer = makeObservabilityLayerWith({
    serviceName,
    level: 'debug',
    sink: { emit: record => logRecords.push(record) },
    spanProcessor: new SimpleSpanProcessor(spanExporter),
  });
  return { layer, logRecords, getSpans: () => spanExporter.getFinishedSpans() };
};
