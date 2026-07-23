import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LogRecord } from '../types.js';
import {
  makeOtlpHttpLogSink,
  toOtlpLogsPayload,
} from './otlp-http-log-sink.js';

const record = (over: Partial<LogRecord> = {}): LogRecord => ({
  timestamp: '2026-07-22T00:00:00.000Z',
  level: 'info',
  severityNumber: 9,
  service: 'svc',
  message: 'hello',
  attributes: {},
  ...over,
});

const okResponse = { ok: true, status: 200 } as Response;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('toOtlpLogsPayload', () => {
  it('encodes each attribute value type', () => {
    const payload = toOtlpLogsPayload(
      [
        record({
          attributes: {
            s: 'str',
            i: 3,
            f: 1.5,
            b: true,
            n: null,
            skip: undefined,
          },
        }),
      ],
      'svc',
    ) as {
      resourceLogs: Array<{
        scopeLogs: Array<{
          logRecords: Array<{ attributes: Array<{ key: string; value: unknown }> }>;
        }>;
      }>;
    };

    const attrs = payload.resourceLogs[0].scopeLogs[0].logRecords[0].attributes;
    expect(attrs).toEqual([
      { key: 's', value: { stringValue: 'str' } },
      { key: 'i', value: { intValue: 3 } },
      { key: 'f', value: { doubleValue: 1.5 } },
      { key: 'b', value: { boolValue: true } },
      { key: 'n', value: { stringValue: 'null' } },
    ]);
  });

  it('sets resource service.name, severity text, body and nanosecond time', () => {
    const payload = toOtlpLogsPayload([record({ level: 'error', severityNumber: 17 })], 'svc') as {
      resourceLogs: Array<{
        resource: { attributes: Array<{ key: string; value: { stringValue: string } }> };
        scopeLogs: Array<{
          scope: { name: string };
          logRecords: Array<{
            severityText: string;
            body: { stringValue: string };
            timeUnixNano: string;
          }>;
        }>;
      }>;
    };

    expect(payload.resourceLogs[0].resource.attributes[0]).toEqual({
      key: 'service.name',
      value: { stringValue: 'svc' },
    });
    const log = payload.resourceLogs[0].scopeLogs[0];
    expect(log.scope.name).toBe('@r10c/entifix-ts-tooling');
    expect(log.logRecords[0].severityText).toBe('ERROR');
    expect(log.logRecords[0].body).toEqual({ stringValue: 'hello' });
    expect(log.logRecords[0].timeUnixNano).toBe(
      (BigInt(Date.parse('2026-07-22T00:00:00.000Z')) * 1_000_000n).toString(),
    );
  });

  it('includes trace/span ids only when present', () => {
    const withTrace = toOtlpLogsPayload(
      [record({ traceId: 't', spanId: 's' })],
      'svc',
    ) as { resourceLogs: Array<{ scopeLogs: Array<{ logRecords: Array<Record<string, unknown>> }> }> };
    const without = toOtlpLogsPayload([record()], 'svc') as typeof withTrace;

    expect(withTrace.resourceLogs[0].scopeLogs[0].logRecords[0]).toMatchObject({
      traceId: 't',
      spanId: 's',
    });
    expect(without.resourceLogs[0].scopeLogs[0].logRecords[0]).not.toHaveProperty(
      'traceId',
    );
  });
});

describe('makeOtlpHttpLogSink', () => {
  it('buffers until batchSize, then POSTs to /v1/logs', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(okResponse);
    const sink = makeOtlpHttpLogSink({
      endpoint: 'http://otel:4318',
      serviceName: 'svc',
      batchSize: 2,
      fetchImpl,
    });

    sink.emit(record());
    expect(fetchImpl).not.toHaveBeenCalled();

    sink.emit(record());
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('http://otel:4318/v1/logs');
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toHaveProperty('resourceLogs');
  });

  it('flush() with an empty buffer does nothing', async () => {
    const fetchImpl = vi.fn(async () => okResponse);
    const sink = makeOtlpHttpLogSink({
      endpoint: 'http://otel:4318',
      serviceName: 'svc',
      fetchImpl,
    });

    await sink.flush();

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('defaults to the global fetch and default batchSize', async () => {
    const fetchImpl = vi.fn(async () => okResponse);
    vi.stubGlobal('fetch', fetchImpl);
    const sink = makeOtlpHttpLogSink({
      endpoint: 'http://otel:4318',
      serviceName: 'svc',
    });

    sink.emit(record());
    expect(fetchImpl).not.toHaveBeenCalled(); // below the default batch size (20)

    await sink.flush();

    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('reports a non-ok response through onError', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 503 }) as Response);
    const onError = vi.fn();
    const sink = makeOtlpHttpLogSink({
      endpoint: 'http://otel:4318',
      serviceName: 'svc',
      fetchImpl,
      onError,
    });

    sink.emit(record());
    await sink.flush();

    expect(onError).toHaveBeenCalledOnce();
    expect((onError.mock.calls[0][0] as Error).message).toContain('503');
  });

  it('reports a thrown fetch through onError', async () => {
    const boom = new Error('network down');
    const fetchImpl = vi.fn(async () => {
      throw boom;
    });
    const onError = vi.fn();
    const sink = makeOtlpHttpLogSink({
      endpoint: 'http://otel:4318',
      serviceName: 'svc',
      fetchImpl,
      onError,
    });

    sink.emit(record());
    await sink.flush();

    expect(onError).toHaveBeenCalledWith(boom);
  });

  it('swallows errors when no onError is supplied', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });
    const sink = makeOtlpHttpLogSink({
      endpoint: 'http://otel:4318',
      serviceName: 'svc',
      fetchImpl,
    });

    sink.emit(record());

    await expect(sink.flush()).resolves.toBeUndefined();
  });
});
