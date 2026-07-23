import { NodeSdk } from '@effect/opentelemetry';
import { context } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import {
  createLogger,
  type Logger as ToolingLogger,
  type LogLevel,
  type LogSink,
  makeOtlpHttpLogSink,
  makeStdoutJsonSink,
} from '@r10c/entifix-ts-tooling/logging';
import { Layer, Logger } from 'effect';

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
      })
    : makeStdoutJsonSink();

/** Map Effect's log-level labels onto the tooling logger's four levels. */
const toToolingLevel = (label: string): LogLevel => {
  switch (label) {
    case 'Trace':
    case 'Debug':
      return 'debug';
    case 'Warning':
      return 'warn';
    case 'Error':
    case 'Fatal':
      return 'error';
    default:
      return 'info';
  }
};

const messageToString = (message: unknown): string =>
  Array.isArray(message)
    ? message.map(part => String(part)).join(' ')
    : String(message);

/**
 * An Effect `Logger` that forwards every Effect log (including the HTTP request
 * logs from `HttpMiddleware.logger`) to the tooling logger — so the whole
 * service logs through one structured, trace-correlated pipeline.
 */
const makeEffectLogger = (logger: ToolingLogger): Logger.Logger<unknown, void> =>
  Logger.make(({ logLevel, message }) => {
    logger[toToolingLevel(logLevel.label)](messageToString(message));
  });

/**
 * The observability composition: replace Effect's default logger with the
 * tooling-backed one, and stand up the OTel tracer/exporter so requests produce
 * spans that ship to the Collector (otel-lgtm in dev). Merged into the service
 * `AppLayer`.
 */
export const makeObservabilityLayer = (config: ObservabilityConfig) => {
  ensureContextManager();
  const toolingLogger = createLogger({
    service: config.serviceName,
    level: config.level,
    sink: makeSink(config),
  });
  const LoggingLayer = Logger.replace(
    Logger.defaultLogger,
    makeEffectLogger(toolingLogger),
  );
  const TracingLayer = NodeSdk.layer(() => ({
    resource: { serviceName: config.serviceName },
    spanProcessor: new BatchSpanProcessor(
      new OTLPTraceExporter({ url: `${config.otelEndpoint}/v1/traces` }),
    ),
  }));
  return Layer.merge(LoggingLayer, TracingLayer);
};
