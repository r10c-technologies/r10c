import type { ScreenType } from '@r10c/business-ts-authz';
import type { ReactNode } from 'react';

export interface NavItem {
  label: string;
  href: string;
  /** Optional leading glyph, shown in both expanded and collapsed states. */
  icon?: ReactNode;
  /**
   * When set, the item also offers "Open in workspace" — a link to
   * `/workspace?tab=<workspace>` that opens this destination as a persisted tab
   * instead of navigating the whole page.
   */
  workspace?: string;
}

export interface NavSection {
  /** The domain group's heading, already translated. */
  title?: string;
  items: NavItem[];
  /**
   * What shape these screens are — the sidebar's **top tier**, above the domain
   * ([ADR 0033](../../../../../../../docs/adr/0033-the-screen-taxonomy.md)).
   *
   * A `ScreenType` rather than a translated string, unlike `title`: the four
   * names are one shipped vocabulary that `SCREEN_TYPE_LABEL_KEYS` maps into the
   * `shell:` namespace, so this component resolves them itself. A host that
   * translated them would be translating copy it does not own.
   *
   * **Optional, and narrowly so.** A section with no type is not a fifth
   * category, it is a section that is not a screen group at all — the account
   * surface is the one case. Untyped sections render below every typed one.
   */
  type?: ScreenType;
}

/** A tier of the sidebar: the sections sharing one {@link ScreenType}. */
export interface NavTier {
  type?: ScreenType;
  sections: NavSection[];
}
