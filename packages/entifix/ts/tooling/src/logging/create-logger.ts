import { trace } from '@opentelemetry/api';

import { SEVERITY_NUMBER, shouldLog } from './level';
import { redactRecord } from './redact';
import type {
  Attributes,
  Logger,
  LogLevel,
  LogRecord,
  LogSink,
  SerializedError,
} from './types';

/** Options for {@link createLogger}. */
export interface CreateLoggerOptions {
  /** Emitting service name (`service.name`). */
  readonly service: string;
  /** Minimum level; anything below is dropped before the sink. */
  readonly level: LogLevel;
  /** Where records go (stdout JSON, OTLP, HTTP proxy, in-memory test double). */
  readonly sink: LogSink;
  /** Record transform applied before emit. Defaults to {@link redactRecord}. */
  readonly redact?: (record: LogRecord) => LogRecord;
  /** Attributes stamped on every record (used by {@link Logger.child}). */
  readonly bindings?: Attributes;
  /** Clock seam for deterministic tests. Defaults to `() => new Date()`. */
  readonly now?: () => Date;
}

const serializeError = (error: unknown): SerializedError =>
  error instanceof Error
    ? { name: error.name, message: error.message, stack: error.stack }
    : { name: 'NonError', message: String(error) };

/**
 * The trace-correlation link: read the active OpenTelemetry span. When a span is
 * active (e.g. an in-flight HTTP request under `@effect/opentelemetry`), its
 * ids are stamped on the record so the log joins its trace in Grafana/Tempo.
 */
const activeSpanContext = (): { traceId?: string; spanId?: string } => {
  const span = trace.getActiveSpan();
  if (span === undefined) {
    return {};
  }
  const context = span.spanContext();
  return { traceId: context.traceId, spanId: context.spanId };
};

/**
 * Build a {@link Logger} over a {@link LogSink}. Framework-free: it stamps
 * timestamp, service, severity number and (when present) trace/span ids, applies
 * redaction, and hands the record to the sink. Transport and backend are chosen
 * entirely by which sink is passed, so the same call site works in every runtime.
 */
export const createLogger = (options: CreateLoggerOptions): Logger => {
  const { service, level, sink } = options;
  const bindings = options.bindings ?? {};
  const redact = options.redact ?? redactRecord;
  const now = options.now ?? (() => new Date());

  const write = (
    logLevel: LogLevel,
    message: string,
    attributes: Attributes,
    error?: unknown,
  ): void => {
    if (!shouldLog(level, logLevel)) {
      return;
    }
    const { traceId, spanId } = activeSpanContext();
    const record: LogRecord = {
      timestamp: now().toISOString(),
      level: logLevel,
      severityNumber: SEVERITY_NUMBER[logLevel],
      service,
      message,
      attributes: { ...bindings, ...attributes },
      ...(traceId !== undefined ? { traceId, spanId } : {}),
      ...(error !== undefined ? { error: serializeError(error) } : {}),
    };
    sink.emit(redact(record));
  };

  return {
    debug: (message, attributes = {}) => write('debug', message, attributes),
    info: (message, attributes = {}) => write('info', message, attributes),
    warn: (message, attributes = {}) => write('warn', message, attributes),
    error: (message, error, attributes = {}) =>
      write('error', message, attributes, error),
    child: bindingsToAdd =>
      createLogger({
        ...options,
        bindings: { ...bindings, ...bindingsToAdd },
      }),
  };
};
