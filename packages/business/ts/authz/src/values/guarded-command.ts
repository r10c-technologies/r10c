import type { Permission } from './permission';

/**
 * A deterministic command plus the permission it requires, if any.
 *
 * The sibling of {@link GuardedNavItem}, and here for the identical reason: this
 * package is the only vocabulary a `layer:shell` package and a `layer:app` both
 * reach, so a `scope:shared` shell can contribute commands to whichever host
 * mounts it without either of them importing the other.
 *
 * It is a *separate* type rather than a nav item with a flag because the two
 * answer different questions. A nav item is a place you can be; a command is
 * something you can do, and it is the thing that has keywords, a page and no
 * sidebar row. Folding them would put `keywordsKey` on every destination and
 * `type` on every command.
 *
 * `labelKey`/`keywordsKey` are **namespace-qualified catalog keys**, not copy —
 * whoever renders the palette does not own the wording, and spelling the
 * namespace out is also what makes an `app:` key visible to the lint rule that
 * keeps those inside `apps/`.
 *
 * Filtering on `permission`/`entitled` is **presentation only**, exactly as it
 * is for navigation: the route behind the command is what refuses the request.
 */
export interface GuardedCommand {
  /** Stable id, unique across every contributing shell. Also the recency key. */
  key: string;
  labelKey: string;
  /**
   * A catalog key whose value is a **comma-separated** list of extra terms this
   * command answers to — how a Spanish command still matches the English word
   * someone typed. `parseKeywords` in `entifix-ts-core` owns the split.
   */
  keywordsKey?: string;
  /** Locale-free, like every other internal href; the renderer prefixes it. */
  href: string;
  /**
   * Which palette page this command sits on. Omitted means the root.
   *
   * Depth is a stack of pages rather than a nested prefix, so a group of related
   * commands — every "new record" route, say — is one root entry that descends
   * instead of N entries competing with the destinations beside them.
   */
  page?: string;
  /** Omit to show the command to every signed-in user. */
  permission?: Permission;
  /**
   * Also gate on the acting organization's provisioning — ADR 0007's second
   * ceiling — using the domain segment of its own {@link permission}, with all
   * the reasoning {@link GuardedNavItem.entitled} carries. Setting it without a
   * permission is the same declaration error, and fails the same way.
   */
  entitled?: boolean;
}

/**
 * The page every "create a record" command descends into.
 *
 * A shared constant rather than a literal in each shell: the domain shells
 * declare commands onto this page and the palette synthesizes the root entry
 * that opens it, so the two halves have to agree and there is no test that
 * would notice a typo — the page would simply be unreachable, with every
 * command still declared and still granted.
 */
export const NEW_COMMAND_PAGE = 'new';
