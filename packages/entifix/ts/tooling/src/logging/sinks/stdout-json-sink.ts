import type { LogRecord, LogSink } from '../types';

/** Options for {@link makeStdoutJsonSink}. */
export interface StdoutJsonSinkOptions {
  /** Write seam (defaults to `process.stdout.write`); overridden in tests. */
  readonly write?: (line: string) => void;
}

/**
 * The production/backend sink: one JSON object per line on stdout. Crash-safe
 * (no buffer to flush) and picked up by the OTel Collector's `filelog` receiver
 * tailing `/var/log/pods`. This is the default in a cluster; dev uses the OTLP
 * sink instead because a host-run `nx dev` process has no pod to tail.
 */
export const makeStdoutJsonSink = (
  options: StdoutJsonSinkOptions = {},
): LogSink => {
  const write = options.write ?? (line => process.stdout.write(line));
  return {
    emit: (record: LogRecord) => {
      write(`${JSON.stringify(record)}\n`);
    },
  };
};
