import { NextResponse } from 'next/server';

import { bearerHeader, sessionToken } from '../session/bearer';
import type {
  RecordSearchGroup,
  RecordSearchResponse,
  RecordSearchUnavailable,
  RecordSearchUnavailableReason,
} from './record-search.types';
import type { RecordSearchSource } from './record-search-source';

export const SEARCH_TERM_PARAM = 'q';
export const SEARCH_SOURCES_PARAM = 'sources';
export const SEARCH_LIMIT_PARAM = 'limit';

/**
 * Below this, nothing is queried at all.
 *
 * A `like` becomes an unanchored, case-insensitive `$regex`, which no index can
 * serve — so this endpoint is a collection scan by construction. One character
 * matches most of every collection and is worth nothing to the person typing, so
 * the floor costs them nothing and saves four scans per keystroke.
 */
export const MIN_TERM_LENGTH = 2;
export const DEFAULT_GROUP_LIMIT = 5;
export const MAX_GROUP_LIMIT = 20;
export const DEFAULT_SOURCE_TIMEOUT_MS = 1_500;

/** Upstream statuses that mean something other than "we could not reach it". */
const REASON_FOR_STATUS: Readonly<
  Record<number, RecordSearchUnavailableReason>
> = {
  400: 'invalidQuery',
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'notFound',
  409: 'noActiveOrganization',
};

export interface RecordSearchRouteOptions {
  /**
   * The sources to fan out over, **in the order results are presented**. That
   * order is the ranking: an operator learns where a kind of record lands, which
   * a relevance score across four unrelated entities cannot offer.
   */
  readonly sources: readonly RecordSearchSource[];
  /** Per-source budget. Concurrent, so this also bounds the whole request. */
  readonly timeoutMs?: number;
  /** Records per group. */
  readonly limit?: number;
}

type SourceOutcome =
  | { readonly ok: true; readonly group: RecordSearchGroup }
  | { readonly ok: false; readonly unavailable: RecordSearchUnavailable };

const unavailable = (
  source: RecordSearchSource,
  reason: RecordSearchUnavailableReason,
  status?: number,
): SourceOutcome => ({
  ok: false,
  unavailable: {
    source: source.key,
    entity: source.entity,
    reason,
    ...(status === undefined ? {} : { status }),
  },
});

/**
 * Ask one source, and **never reject**.
 *
 * Returning a typed outcome rather than throwing is what makes the fan-out a
 * plain `Promise.all`: isolation comes from this catch, not from
 * `allSettled` — whose rejected arm would then be unreachable and untestable.
 */
const runSource = async (
  source: RecordSearchSource,
  term: string,
  limit: number,
  token: string | undefined,
  timeoutMs: number,
): Promise<SourceOutcome> => {
  let upstream: Response;
  try {
    upstream = await fetch(source.url(term, limit), {
      headers: bearerHeader(token),
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    // `AbortSignal.timeout` rejects with a `DOMException` named `TimeoutError`;
    // branching on the name rather than the class keeps this reachable from a
    // test without fabricating a platform error.
    return unavailable(
      source,
      (error as { name?: string }).name === 'TimeoutError'
        ? 'timeout'
        : 'network',
    );
  }

  if (!upstream.ok) {
    return unavailable(
      source,
      REASON_FOR_STATUS[upstream.status] ?? 'unexpected',
      upstream.status,
    );
  }

  const body = await upstream.json().catch(() => undefined);
  const page = source.read(body);
  return page === undefined
    ? unavailable(source, 'unexpected', upstream.status)
    : {
        ok: true,
        group: {
          source: source.key,
          entity: source.entity,
          labelKey: source.labelKey,
          items: page.items,
          total: page.total,
        },
      };
};

const clampLimit = (raw: string | null, fallback: number): number => {
  const asked = Number(raw);
  if (!Number.isInteger(asked) || asked < 1) return fallback;
  return Math.min(asked, MAX_GROUP_LIMIT);
};

/**
 * `GET /api/search` — records matching a term, across every source this host
 * mounts (ADR 0040).
 *
 * The caller's own session is the only credential that crosses: each source is
 * asked over the same guarded route its screens use, so what comes back is
 * already authorized for this principal and this organization. There is no
 * index, and there must never be one — a prefetched index is a tenant leak, and
 * it is the reason this is a fan-out rather than a search service.
 *
 * A source that fails is **named** in `unavailable` rather than dropped. An
 * absent group renders as "no matches", which is a confident claim the server is
 * in no position to make about a service it could not reach.
 */
export const createRecordSearchRoute = ({
  sources,
  timeoutMs = DEFAULT_SOURCE_TIMEOUT_MS,
  limit: defaultLimit = DEFAULT_GROUP_LIMIT,
}: RecordSearchRouteOptions) => {
  const byKey = new Map(sources.map(source => [source.key, source]));

  return async function GET(request: Request): Promise<Response> {
    // The services decide what this caller may read; this only carries the
    // token. But the gate is not redundant: `catalog-reference` reads are
    // unauthenticated at the service by design, so without it a signed-out
    // caller gets brand matches back and the answer reads as a real search —
    // and the endpoint becomes an anonymous amplifier against that service.
    const token = await sessionToken();
    if (token === undefined) {
      return NextResponse.json(
        { error: 'unauthenticated', code: 'unauthenticated' },
        { status: 401 },
      );
    }

    const params = new URL(request.url).searchParams;

    const asked = (params.get(SEARCH_SOURCES_PARAM) ?? '')
      .split(',')
      .filter(name => name !== '');
    const unknown = asked.find(name => !byKey.has(name));
    if (unknown !== undefined) {
      // Loud rather than ignored: no keystroke can produce this, only a caller
      // naming a source that does not exist — and silently searching everything
      // instead would answer a question nobody asked.
      return NextResponse.json(
        {
          error: 'invalid query',
          code: 'invalidQuery',
          detail: `unknown search source "${unknown}"`,
        },
        { status: 400 },
      );
    }
    const selected =
      asked.length === 0
        ? sources
        : sources.filter(source => asked.includes(source.key));

    const term = (params.get(SEARCH_TERM_PARAM) ?? '').trim();
    const answer = (body: RecordSearchResponse) =>
      // The body is scoped to one principal and one organization. `no-store` is
      // correctness here, not tuning.
      NextResponse.json(body, { headers: { 'cache-control': 'no-store' } });

    if (term.length < MIN_TERM_LENGTH) {
      return answer({ term, groups: [], unavailable: [] });
    }

    const limit = clampLimit(params.get(SEARCH_LIMIT_PARAM), defaultLimit);
    const outcomes = await Promise.all(
      selected.map(source => runSource(source, term, limit, token, timeoutMs)),
    );

    return answer({
      term,
      // Declared order, never completion order — otherwise the list reshuffles
      // with the network and nobody can learn where anything lands.
      groups: outcomes.flatMap(outcome => (outcome.ok ? [outcome.group] : [])),
      unavailable: outcomes.flatMap(outcome =>
        outcome.ok ? [] : [outcome.unavailable],
      ),
    });
  };
};
