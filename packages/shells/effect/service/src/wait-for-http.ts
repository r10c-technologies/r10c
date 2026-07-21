/** How long a readiness wait keeps trying, and how often. */
export interface WaitForHttpOptions {
  /** Total attempts before giving up. */
  attempts?: number;
  /** Pause between attempts, in milliseconds. */
  delayMs?: number;
}

const sleep = (ms: number) =>
  new Promise<void>(resolve => {
    setTimeout(resolve, ms);
  });

/**
 * Polls `url` until it answers, or throws once the attempts run out.
 *
 * A freshly launched server is not listening on the very next tick, so an
 * in-process boot needs a readiness gate before the first request. This is that
 * gate, kept separate from the boot itself so both its outcomes — answers on a
 * later attempt, never answers at all — are reachable from a spec without
 * racing a real server.
 */
export const waitForHttp = async (
  url: string,
  { attempts = 50, delayMs = 50 }: WaitForHttpOptions = {},
): Promise<void> => {
  let lastError: unknown;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await fetch(url);
      return;
    } catch (error) {
      lastError = error;
      await sleep(delayMs);
    }
  }

  throw new Error(
    `Timed out waiting for ${url} after ${attempts} attempts: ${String(lastError)}`,
  );
};
