import type { Permission } from './permission';

/**
 * A navigation destination plus the permission it requires, if any.
 *
 * This is the permission-annotated half of navigation, which is why it lives with
 * the authorization vocabulary rather than in a shell: an entry and the route
 * behind it must be expressed in the same terms `requirePermission` enforces, and
 * `can` — the filter every layer applies — is declared right next to it.
 *
 * It is also the only layer both a `layer:shell` package and a `layer:app` can
 * depend on. That matters because a `scope:shared` shell contributes its own nav
 * fragment to whichever host mounts it, and shells may not depend on each other.
 *
 * `label`/`title` are **namespace-qualified catalog keys**, not copy. Whoever
 * renders the list does not necessarily own its wording, so the namespace travels
 * with the key — and spelling it out is also what makes an `app:` key visible to
 * the lint rule that keeps those keys inside `apps/`.
 *
 * Filtering on these is **presentation only**. Hiding an entry protects nothing;
 * the service is what refuses the request.
 */
export interface GuardedNavItem {
  label: string;
  href: string;
  icon?: string;
  /**
   * When set, the item also offers "Open in workspace" — a link to
   * `/workspace?tab=<workspace>`.
   */
  workspace?: string;
  /** Omit to show the item to every signed-in user. */
  permission?: Permission;
}

export interface GuardedNavSection {
  title?: string;
  items: GuardedNavItem[];
}
