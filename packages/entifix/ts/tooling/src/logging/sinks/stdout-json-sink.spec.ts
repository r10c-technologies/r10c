import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LogRecord } from '../types.js';
import { makeStdoutJsonSink } from './stdout-json-sink.js';

const record: LogRecord = {
  timestamp: '2026-07-22T00:00:00.000Z',
  level: 'info',
  severityNumber: 9,
  service: 'svc',
  message: 'hello',
  attributes: { a: 1 },
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('makeStdoutJsonSink', () => {
  it('writes one JSON line via a custom write seam', () => {
    const lines: string[] = [];
    const sink = makeStdoutJsonSink({ write: line => lines.push(line) });

    sink.emit(record);

    expect(lines).toHaveLength(1);
    expect(lines[0].endsWith('\n')).toBe(true);
    expect(JSON.parse(lines[0])).toEqual(record);
  });

  it('defaults to process.stdout.write', () => {
    const spy = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    const sink = makeStdoutJsonSink();

    sink.emit(record);

    expect(spy).toHaveBeenCalledOnce();
    expect(String(spy.mock.calls[0][0])).toContain('"message":"hello"');
  });
});
