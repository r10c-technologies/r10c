import type { AttributeValue, LogRecord, LogSink } from '../types';

/**
 * The dev sink: batches records and POSTs them as OTLP/HTTP JSON to a Collector
 * (the local `grafana/otel-lgtm` at its `/v1/logs` endpoint). Hand-rolled on
 * `fetch` so the framework-free leaf keeps a single runtime dep
 * (`@opentelemetry/api`) instead of pulling the OTel logs SDK.
 */
export interface OtlpHttpLogSinkOptions {
  /** Collector base URL, e.g. `http://127.0.0.1:30318`. `/v1/logs` is appended. */
  readonly endpoint: string;
  /** `service.name` stamped on the OTLP resource. */
  readonly serviceName: string;
  /** Flush once the buffer reaches this many records (default 20). */
  readonly batchSize?: number;
  /**
   * Also flush on this interval (ms) so low-volume producers are not stuck below
   * {@link batchSize}. Omit for size-only flushing. The timer is `unref`'d so it
   * never keeps the process alive.
   */
  readonly flushIntervalMs?: number;
  /** `fetch` seam; defaults to the global. */
  readonly fetchImpl?: typeof fetch;
  /** Called when a flush fails (default: swallow — telemetry is best-effort). */
  readonly onError?: (error: unknown) => void;
}

/** A {@link LogSink} that can be flushed on demand (e.g. before shutdown). */
export interface OtlpHttpLogSink extends LogSink {
  flush(): Promise<void>;
}

interface OtlpAnyValue {
  stringValue?: string;
  intValue?: number;
  doubleValue?: number;
  boolValue?: boolean;
}

const toAnyValue = (value: AttributeValue): OtlpAnyValue => {
  if (typeof value === 'string') {
    return { stringValue: value };
  }
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { intValue: value }
      : { doubleValue: value };
  }
  if (typeof value === 'boolean') {
    return { boolValue: value };
  }
  // `null` (the only remaining AttributeValue) carries no typed value.
  return { stringValue: 'null' };
};

const toKeyValues = (
  attributes: Record<string, AttributeValue | undefined>,
): Array<{ key: string; value: OtlpAnyValue }> => {
  const out: Array<{ key: string; value: OtlpAnyValue }> = [];
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined) {
      out.push({ key, value: toAnyValue(value) });
    }
  }
  return out;
};

const SEVERITY_TEXT: Record<LogRecord['level'], string> = {
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR',
};

/**
 * Encode records into the OTLP/HTTP JSON `logs` payload. Exported so the shape
 * is unit-testable without a live Collector.
 */
export const toOtlpLogsPayload = (
  records: readonly LogRecord[],
  serviceName: string,
): unknown => ({
  resourceLogs: [
    {
      resource: {
        attributes: [
          { key: 'service.name', value: { stringValue: serviceName } },
        ],
      },
      scopeLogs: [
        {
          scope: { name: '@r10c/entifix-ts-tooling' },
          logRecords: records.map(record => ({
            timeUnixNano: (
              BigInt(Date.parse(record.timestamp)) * 1_000_000n
            ).toString(),
            severityNumber: record.severityNumber,
            severityText: SEVERITY_TEXT[record.level],
            body: { stringValue: record.message },
            attributes: toKeyValues(record.attributes),
            ...(record.traceId !== undefined
              ? { traceId: record.traceId, spanId: record.spanId }
              : {}),
          })),
        },
      ],
    },
  ],
});

/** Build a batching OTLP/HTTP log sink. */
export const makeOtlpHttpLogSink = (
  options: OtlpHttpLogSinkOptions,
): OtlpHttpLogSink => {
  const batchSize = options.batchSize ?? 20;
  // Resolve the global `fetch` at call time (bound to `globalThis`): a bare
  // `fetch` reference can be dropped by a bundler, whereas `globalThis.fetch`
  // survives bundling and stays correct in Node and the browser.
  const fetchImpl =
    options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  const onError = options.onError ?? (() => undefined);
  const url = `${options.endpoint}/v1/logs`;
  let buffer: LogRecord[] = [];

  const flush = async (): Promise<void> => {
    if (buffer.length === 0) {
      return;
    }
    const batch = buffer;
    buffer = [];
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(toOtlpLogsPayload(batch, options.serviceName)),
      });
      if (!response.ok) {
        onError(new Error(`OTLP logs export failed: ${response.status}`));
      }
    } catch (error) {
      onError(error);
    }
  };

  if (options.flushIntervalMs !== undefined) {
    const timer = setInterval(() => void flush(), options.flushIntervalMs);
    // Never let the flush timer hold the process open.
    (timer as { unref?: () => void }).unref?.();
  }

  return {
    emit: (record: LogRecord) => {
      buffer.push(record);
      if (buffer.length >= batchSize) {
        void flush();
      }
    },
    flush,
  };
};
