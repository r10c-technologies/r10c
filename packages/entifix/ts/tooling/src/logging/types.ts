/**
 * The logging facade's public shape. Framework-free on purpose: the same
 * interface serves Effect backends, the Next server runtime, and the browser,
 * because it is built on the OpenTelemetry log-record model rather than on any
 * one framework's logger. See `docs/ARCHITECTURE.md` (Observability & tooling).
 */

/** The four log levels the platform uses, in ascending severity. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** A single structured attribute value. `undefined` keys are dropped by JSON. */
export type AttributeValue = string | number | boolean | null;

/** Structured key/value context attached to a log line. */
export interface Attributes {
  readonly [key: string]: AttributeValue | undefined;
}

/** An error flattened to a serializable shape (never a live `Error` instance). */
export interface SerializedError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
}

/**
 * One structured log record. This is the wire shape every sink receives; it
 * mirrors the OpenTelemetry LogRecord (severity number, body, attributes,
 * trace/span correlation) so a sink can forward it as OTLP unchanged.
 */
export interface LogRecord {
  /** ISO-8601 timestamp. */
  readonly timestamp: string;
  readonly level: LogLevel;
  /** OTel `SeverityNumber` for {@link level}. */
  readonly severityNumber: number;
  /** Emitting service name (`service.name`). */
  readonly service: string;
  readonly message: string;
  readonly attributes: Attributes;
  /** Present only when a span is active — this is the trace-correlation link. */
  readonly traceId?: string;
  readonly spanId?: string;
  readonly error?: SerializedError;
}

/**
 * A transport for log records. The seam that keeps the package portable: the
 * backend uses a stdout-JSON sink (tailed by the Collector's filelog receiver),
 * the browser an HTTP sink to `/api/telemetry`, dev an OTLP sink to otel-lgtm.
 */
export interface LogSink {
  emit(record: LogRecord): void;
}

/** The leveled logger applications call. */
export interface Logger {
  debug(message: string, attributes?: Attributes): void;
  info(message: string, attributes?: Attributes): void;
  warn(message: string, attributes?: Attributes): void;
  /** `error` carries an optional cause alongside the structured attributes. */
  error(message: string, error?: unknown, attributes?: Attributes): void;
  /** Returns a logger that stamps every record with `bindings` (e.g. per-request). */
  child(bindings: Attributes): Logger;
}
