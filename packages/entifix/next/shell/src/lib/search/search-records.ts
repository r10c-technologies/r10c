import type { RecordSearchResponse } from './record-search.types';

/** Where the aggregating route is mounted. Same-origin, so the cookie rides along. */
export const RECORD_SEARCH_PATH = '/api/search';

export interface SearchRecordsOptions {
  /** Aborts an in-flight request when the term moves on. */
  readonly signal?: AbortSignal;
  /** Narrow the fan-out to these source keys. Omit to ask every source. */
  readonly sources?: readonly string[];
  /** Records per group. */
  readonly limit?: number;
}

/**
 * Ask the back office for records matching `term`.
 *
 * Deliberately framework-free — no React, no router, no debounce, no retry. It
 * is a typed `fetch`, so the palette can own its own keystroke policy (which is
 * where debounce and abort belong) and a server component or a test can call the
 * same function.
 *
 * Same-origin on purpose: `r10c_at` is httpOnly and `sameSite: 'lax'`, so a
 * cross-origin call would carry no session and every group would come back
 * unavailable.
 */
export const searchRecords = async (
  term: string,
  { signal, sources, limit }: SearchRecordsOptions = {},
): Promise<RecordSearchResponse> => {
  const params = new URLSearchParams({ q: term });
  if (sources !== undefined && sources.length > 0) {
    params.set('sources', sources.join(','));
  }
  if (limit !== undefined) params.set('limit', String(limit));

  const response = await fetch(`${RECORD_SEARCH_PATH}?${params.toString()}`, {
    cache: 'no-store',
    ...(signal === undefined ? {} : { signal }),
  });

  if (!response.ok) {
    // The route answers `401` for a lapsed session and `400` for a caller naming
    // a source that does not exist. Neither is a per-source degradation — those
    // arrive inside a `200` — so both are the caller's to handle.
    throw new Error(`record search failed with ${response.status}`);
  }

  return (await response.json()) as RecordSearchResponse;
};
