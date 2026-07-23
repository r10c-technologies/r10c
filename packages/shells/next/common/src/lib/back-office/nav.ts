import type { ReactNode } from 'react';

export interface NavItem {
  label: string;
  href: string;
  /** Optional leading glyph, shown in both expanded and collapsed states. */
  icon?: ReactNode;
}

export interface NavSection {
  /** Optional group heading (hidden while the sidebar is collapsed). */
  title?: string;
  items: NavItem[];
}
