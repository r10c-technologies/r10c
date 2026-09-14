/**
 * A deterministic command, with its copy already resolved.
 *
 * The wire shape between a **server** layout — which is where `visibleNav`'s
 * principal and the translate function live — and the client palette. So it is
 * plain serializable data and nothing else: a `GuardedCommand` carries catalog
 * keys and a `Permission`, neither of which a client component should have to
 * deal with, and a function would not survive the crossing at all.
 */
export interface PaletteCommand {
  /** Stable across renders and hosts. Also the recency key. */
  readonly key: string;
  readonly label: string;
  /** Already split from the catalog's comma list by the host. */
  readonly keywords: readonly string[];
  /** Locale-free; the palette prefixes it. */
  readonly href: string;
  /** The page this command sits on. Omitted means the root. */
  readonly page?: string;
}

/**
 * How many characters before records are queried at all.
 *
 * The same floor `/api/search` enforces, restated here so the palette can *say*
 * why a record group is absent instead of silently showing nothing. Below it the
 * route answers empty groups, which would otherwise read as "no matches" for a
 * search that never ran.
 */
export const RECORD_SEARCH_MIN_TERM = 2;

/** How long after the last keystroke the fan-out runs. */
export const RECORD_SEARCH_DEBOUNCE_MS = 250;
