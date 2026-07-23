import { describe, expect, it } from 'vitest';

import { SEVERITY_NUMBER, shouldLog } from './level.js';
import type { LogLevel } from './types.js';

describe('SEVERITY_NUMBER', () => {
  it('maps each level to its OTel SeverityNumber', () => {
    expect(SEVERITY_NUMBER).toEqual({ debug: 5, info: 9, warn: 13, error: 17 });
  });
});

describe('shouldLog', () => {
  const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];

  it('passes a record at or above the minimum', () => {
    expect(shouldLog('info', 'info')).toBe(true);
    expect(shouldLog('info', 'error')).toBe(true);
    expect(shouldLog('debug', 'debug')).toBe(true);
  });

  it('drops a record below the minimum', () => {
    expect(shouldLog('info', 'debug')).toBe(false);
    expect(shouldLog('error', 'warn')).toBe(false);
  });

  it('lets everything through at the lowest minimum', () => {
    for (const level of levels) {
      expect(shouldLog('debug', level)).toBe(true);
    }
  });
});
