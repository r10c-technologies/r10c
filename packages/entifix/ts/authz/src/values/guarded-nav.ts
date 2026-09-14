import type { Permission } from './permission';
import type { ScreenType } from './screen-type';

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
  /**
   * Also gate this item on the acting organization's provisioning — ADR 0007's
   * second ceiling — using the domain segment of its own {@link permission}.
   *
   * A boolean rather than a domain name, because the domain is already written
   * one line up: a second string here could disagree with the permission the
   * route behind it actually checks, which is the drift this whole interface
   * exists to prevent.
   *
   * **Omitted is the right answer for most items.** An organization is not
   * "provisioned for" `catalog-reference`, `config` or `authn` — those are
   * operator-owned, and `catalog-reference` is explicitly never grantable
   * (ADR 0022). Setting this on one of them would hide the platform's own
   * vocabulary from every vendor.
   *
   * Setting it without a `permission` is a declaration error and throws: there
   * would be no domain to read, and both possible defaults — always shown,
   * always hidden — read as a bug somewhere else entirely.
   *
   * A session with **no** organization ignores this flag: the ceiling is a
   * property of an organization, so an operator is outside it rather than
   * refused by it.
   */
  entitled?: boolean;
}

export interface GuardedNavSection {
  title?: string;
  items: GuardedNavItem[];
  /**
   * What shape these screens are — the top tier of the sidebar, above the
   * domain ([ADR 0033](../../../../../../docs/adr/0033-the-screen-taxonomy.md)).
   *
   * Every contributing shell declares its own, because this interface is the
   * only thing a `layer:shell` package and a `layer:app` both reach: adding the
   * tier is not an edit in the host.
   *
   * **Optional, and narrowly so.** A section with no type is not a fifth
   * category, it is a section that is not a screen group at all — the account
   * surface is the one case, and it carries no permission for the same reason.
   * A second untyped section appearing without a written reason means the
   * taxonomy is missing a case.
   */
  type?: ScreenType;
}
