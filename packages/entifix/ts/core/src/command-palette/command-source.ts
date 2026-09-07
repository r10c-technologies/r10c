/**
 * What a command palette renders, as state rather than as a query.
 *
 * The same contract `EntityLinkSource` is, and for the same boundary reason: the
 * hooks that fetch live in the shell layer, the component that renders lives in
 * `entifix-react-controls`, and those two may not import each other. It carries
 * no Effect, no React and no router — a source hands over resolved copy and a
 * thunk, never a key and never a `push()`.
 */

/** How a group's absence is explained. */
export type CommandUnavailableSeverity = 'scope' | 'reachability';

/**
 * A source that produced no options, and why.
 *
 * The two severities must not be conflated, which is the same split ADR 0040's
 * `RecordSearchUnavailableReason` draws and the reason this member is not a
 * bare string. `scope` is the **normal** state for some callers — an operator
 * holds no membership, so every tenant-plane search answers `409` on every
 * keystroke — while `reachability` means something is actually wrong. Rendering
 * a warning for the ordinary case teaches people to ignore the one that matters.
 */
export interface CommandUnavailable {
  /** Already-resolved copy. The source owns the catalog lookup. */
  readonly message: string;
  readonly severity: CommandUnavailableSeverity;
}

/** What selecting an option does. Exactly one arm is populated. */
export interface CommandEffect {
  /**
   * Navigate. **Already locale-prefixed** by the source, because the palette is
   * presentational and a control may not reach for a router or a locale.
   */
  readonly href?: string;
  /** Invoke. The source owns the request, the optimism and the error. */
  readonly run?: () => void | Promise<void>;
  /** Descend into another {@link CommandPage} by id — this is the page stack. */
  readonly push?: string;
}

/** Ask before running. Resolved copy, like everything else that crosses here. */
export interface CommandConfirm {
  readonly tone: 'destructive' | 'neutral';
  readonly message: string;
}

/** One selectable line. */
export interface CommandOption extends CommandEffect {
  /** Unique within the whole palette — it is also the recency key. */
  readonly id: string;
  /** Resolved copy. A source that holds a catalog key resolves it before here. */
  readonly label: string;
  /** A second line: a code, a role, the record's entity. */
  readonly sublabel?: string;
  /**
   * Extra terms this option matches on, so a Spanish command still answers to
   * the English word someone typed. Raycast's mechanism, and the reason
   * `MetaUseCase` carries a `keywordsKey` at all.
   */
  readonly keywords?: readonly string[];
  /** Trailing text — a shortcut hint, the source's own name. */
  readonly hint?: string;
  readonly confirm?: CommandConfirm;
}

/** One heading and the options under it. */
export interface CommandGroup {
  readonly key: string;
  /** Resolved copy. */
  readonly label: string;
  readonly options: readonly CommandOption[];
  /**
   * Matches **before** any per-group limit, so "N más" is renderable. Omitted
   * when the source did not count — never defaulted to `options.length`, which
   * would claim there is no more when nobody looked.
   */
  readonly total?: number;
  readonly isLoading: boolean;
  /**
   * Set when this group could not be produced. A group carrying this is still
   * rendered: an omitted group reads as "nothing matched", which is a confident
   * claim nobody is in a position to make about a source they could not reach.
   */
  readonly unavailable?: CommandUnavailable;
}

/**
 * One contributor's whole answer.
 *
 * Several groups, not one, because the record search fans out over four entities
 * and each is its own heading — flattening them here would make the palette
 * re-derive what ADR 0040 already grouped.
 */
export interface CommandSource {
  readonly key: string;
  readonly groups: readonly CommandGroup[];
}

/**
 * One level of the palette.
 *
 * Depth is a **stack of pages** rather than nested prefixes: selecting "Nuevo…"
 * makes the palette *become* the entity picker, which is Raycast's and Linear's
 * arrangement and reads far better than a second grammar character.
 */
export interface CommandPage {
  readonly id: string;
  /** Shown as a chip beside the input on any page but the root. */
  readonly title?: string;
  readonly placeholder: string;
  readonly sources: readonly CommandSource[];
}

/** The id of the page a palette opens on. */
export const ROOT_COMMAND_PAGE = 'root';
