import type { LogLevel } from './types';

/**
 * OpenTelemetry `SeverityNumber` for each level (DEBUG=5, INFO=9, WARN=13,
 * ERROR=17). Emitting the standard number lets any OTel backend filter/colour
 * logs without knowing our string names.
 */
export const SEVERITY_NUMBER: Record<LogLevel, number> = {
  debug: 5,
  info: 9,
  warn: 13,
  error: 17,
};

/** Ascending rank used to gate records below the configured minimum. */
const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * Whether a record at `level` passes a logger configured with minimum `min`.
 * A DEBUG record on a WARN logger is dropped before it ever reaches a sink.
 */
export const shouldLog = (min: LogLevel, level: LogLevel): boolean =>
  LEVEL_ORDER[level] >= LEVEL_ORDER[min];
