import { describe, expect, it } from 'vitest';

import {
  DEFAULT_REDACT_KEYS,
  redactAttributes,
  REDACTED,
  redactRecord,
} from './redact.js';
import type { LogRecord } from './types.js';

const baseRecord: LogRecord = {
  timestamp: '2026-07-22T00:00:00.000Z',
  level: 'info',
  severityNumber: 9,
  service: 'svc',
  message: 'hello',
  attributes: {},
};

describe('redactAttributes', () => {
  it('masks matching keys case-insensitively and keeps the rest', () => {
    const out = redactAttributes({
      Authorization: 'Bearer x',
      r10c_at: 'token',
      userId: 'u1',
      count: 3,
    });

    expect(out).toEqual({
      Authorization: REDACTED,
      r10c_at: REDACTED,
      userId: 'u1',
      count: 3,
    });
  });

  it('honours a custom key list', () => {
    const out = redactAttributes({ secretField: 'x', keep: 'y' }, [
      'secretField',
    ]);

    expect(out).toEqual({ secretField: REDACTED, keep: 'y' });
  });

  it('exposes the canonical default keys', () => {
    expect(DEFAULT_REDACT_KEYS).toContain('authorization');
    expect(DEFAULT_REDACT_KEYS).toContain('r10c_at');
    expect(DEFAULT_REDACT_KEYS).toContain('password');
  });
});

describe('redactRecord', () => {
  it('returns a copy with redacted attributes, other fields intact', () => {
    const record: LogRecord = {
      ...baseRecord,
      attributes: { password: 'hunter2', keep: 'ok' },
    };

    const out = redactRecord(record);

    expect(out.attributes).toEqual({ password: REDACTED, keep: 'ok' });
    expect(out.message).toBe('hello');
    expect(out).not.toBe(record);
  });

  it('accepts a custom key list', () => {
    const out = redactRecord(
      { ...baseRecord, attributes: { custom: 'v', keep: 'ok' } },
      ['custom'],
    );

    expect(out.attributes).toEqual({ custom: REDACTED, keep: 'ok' });
  });
});
