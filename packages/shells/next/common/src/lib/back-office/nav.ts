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
  /** Optional group heading (hidden while the sidebar is collapsed). */
  title?: string;
  items: NavItem[];
}
