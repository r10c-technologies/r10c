import { trace } from '@opentelemetry/api';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLogger } from './create-logger.js';
import type { LogRecord, LogSink } from './types.js';

const collectingSink = (): { records: LogRecord[]; sink: LogSink } => {
  const records: LogRecord[] = [];
  return { records, sink: { emit: record => records.push(record) } };
};

const fixedNow = () => new Date('2026-07-22T12:00:00.000Z');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('createLogger', () => {
  it('emits a structured record with the standard fields', () => {
    const { records, sink } = collectingSink();
    const log = createLogger({
      service: 'svc',
      level: 'debug',
      sink,
      now: fixedNow,
    });

    log.info('hello', { userId: 'u1' });

    expect(records).toHaveLength(1);
    expect(records[0]).toEqual({
      timestamp: '2026-07-22T12:00:00.000Z',
      level: 'info',
      severityNumber: 9,
      service: 'svc',
      message: 'hello',
      attributes: { userId: 'u1' },
    });
  });

  it('supports every level and defaults attributes to empty', () => {
    const { records, sink } = collectingSink();
    const log = createLogger({ service: 'svc', level: 'debug', sink });

    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');

    expect(records.map(r => r.level)).toEqual(['debug', 'info', 'warn', 'error']);
    expect(records.every(r => Object.keys(r.attributes).length === 0)).toBe(true);
    expect(typeof records[0].timestamp).toBe('string');
  });

  it('drops records below the configured minimum level', () => {
    const { records, sink } = collectingSink();
    const log = createLogger({ service: 'svc', level: 'warn', sink });

    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');

    expect(records.map(r => r.level)).toEqual(['warn', 'error']);
  });

  it('stamps trace/span ids from the active span (correlation)', () => {
    vi.spyOn(trace, 'getActiveSpan').mockReturnValue({
      spanContext: () => ({ traceId: 'trace-1', spanId: 'span-1', traceFlags: 1 }),
    } as never);
    const { records, sink } = collectingSink();
    const log = createLogger({ service: 'svc', level: 'debug', sink });

    log.info('correlated');

    expect(records[0].traceId).toBe('trace-1');
    expect(records[0].spanId).toBe('span-1');
  });

  it('omits trace ids when no span is active', () => {
    vi.spyOn(trace, 'getActiveSpan').mockReturnValue(undefined);
    const { records, sink } = collectingSink();
    const log = createLogger({ service: 'svc', level: 'debug', sink });

    log.info('no span');

    expect(records[0].traceId).toBeUndefined();
    expect(records[0].spanId).toBeUndefined();
  });

  it('serializes an Error cause on error()', () => {
    const { records, sink } = collectingSink();
    const log = createLogger({ service: 'svc', level: 'debug', sink });

    log.error('boom', new Error('kaboom'), { route: '/x' });

    expect(records[0].error).toMatchObject({ name: 'Error', message: 'kaboom' });
    expect(records[0].error?.stack).toContain('kaboom');
    expect(records[0].attributes).toEqual({ route: '/x' });
  });

  it('serializes a non-Error cause', () => {
    const { records, sink } = collectingSink();
    const log = createLogger({ service: 'svc', level: 'debug', sink });

    log.error('boom', 'just a string');

    expect(records[0].error).toEqual({ name: 'NonError', message: 'just a string' });
  });

  it('omits error when none is passed', () => {
    const { records, sink } = collectingSink();
    const log = createLogger({ service: 'svc', level: 'debug', sink });

    log.error('no cause');

    expect(records[0].error).toBeUndefined();
  });

  it('child() merges bindings into every record', () => {
    const { records, sink } = collectingSink();
    const log = createLogger({
      service: 'svc',
      level: 'debug',
      sink,
      bindings: { app: 'admin' },
    });

    const child = log.child({ requestId: 'r1' });
    child.info('scoped', { extra: true });

    expect(records[0].attributes).toEqual({
      app: 'admin',
      requestId: 'r1',
      extra: true,
    });
  });

  it('applies a custom redact transform', () => {
    const { records, sink } = collectingSink();
    const log = createLogger({
      service: 'svc',
      level: 'debug',
      sink,
      redact: record => ({ ...record, message: 'REDACTED' }),
    });

    log.info('secret', { token: 'abc' });

    expect(records[0].message).toBe('REDACTED');
    // Custom redact replaced the default, so attributes are untouched.
    expect(records[0].attributes).toEqual({ token: 'abc' });
  });

  it('redacts sensitive attributes by default', () => {
    const { records, sink } = collectingSink();
    const log = createLogger({ service: 'svc', level: 'debug', sink });

    log.info('login', { authorization: 'Bearer x', userId: 'u1' });

    expect(records[0].attributes).toEqual({
      authorization: '***',
      userId: 'u1',
    });
  });
});
