/**
 * The wire contract of `GET /api/search` — the cross-domain record search the
 * command palette reads (ADR 0040).
 *
 * Types only, so both halves can name them: the route handler builds these on
 * the server, and the browser's `searchRecords` returns them. A type crosses the
 * client/server entry split freely because it erases.
 */

/**
 * Why a source produced no group.
 *
 * The split is the point, and it is not cosmetic. `forbidden` and
 * `noActiveOrganization` are the **normal** state for some callers on some
 * sources — an operator holds no membership, so every tenant-plane search
 * answers `409` — and rendering "we could not reach this" for the ordinary case
 * teaches an operator to ignore the warning. `timeout`/`network`/`unexpected`
 * are the ones that mean something is actually wrong.
 *
 * Every member is a key in the shared `errors` catalog, so a caller renders one
 * through the documented runtime-key hatch rather than inventing copy.
 */
export type RecordSearchUnavailableReason =
  | 'timeout'
  | 'network'
  | 'unauthenticated'
  | 'forbidden'
  | 'noActiveOrganization'
  | 'invalidQuery'
  | 'notFound'
  | 'unexpected';

/** One record a caller can show and route to. */
export interface RecordSearchOption {
  readonly id: string;
  readonly label: string;
  /** A secondary line — a code, a role. Absent when the source declared none. */
  readonly sublabel?: string;
  /**
   * `envelopeEntityName(Ctor)` — `key ?? name`.
   *
   * Repeated on every option rather than left to the group, because an option is
   * routed on its own once a caller has flattened the list: `['entity', entity]`
   * is exactly `entityQueryScope`'s output, and `entity:<entity>:<id>` is the
   * workspace tab address.
   */
  readonly entity: string;
  /**
   * Where selecting this record lands, **without** a locale prefix — the caller
   * adds one, the same way every other internal href in the back office works.
   */
  readonly href: string;
}

/** One source's answer. */
export interface RecordSearchGroup {
  /** The source's declared key. Stable, and the caller's ordering. */
  readonly source: string;
  readonly entity: string;
  /**
   * The heading, as the entity's own `pluralKey`. A key rather than copy,
   * because the server has no locale — and the entity catalogs already carry one
   * for every source, so record search introduces no copy of its own.
   */
  readonly labelKey: string;
  readonly items: readonly RecordSearchOption[];
  /**
   * Matches **before** the per-group limit, so "3 more" is renderable. A
   * reachable source with no matches is a present group with an empty `items`,
   * never an omission — that distinction is the whole reason
   * {@link RecordSearchResponse.unavailable} exists.
   */
  readonly total: number;
}

/** One source that produced nothing, and why. */
export interface RecordSearchUnavailable {
  readonly source: string;
  readonly entity: string;
  readonly reason: RecordSearchUnavailableReason;
  /** The upstream status, when there was a response. Absent on a throw. */
  readonly status?: number;
}

/**
 * The whole answer.
 *
 * A degraded source is **named**, never a silently missing group. An empty group
 * is a confident claim that there are no matching records, and a search that
 * confidently reports nothing when it in fact could not look is the failure
 * mode this shape exists to prevent.
 */
export interface RecordSearchResponse {
  readonly term: string;
  readonly groups: readonly RecordSearchGroup[];
  readonly unavailable: readonly RecordSearchUnavailable[];
}
