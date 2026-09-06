import { screenTypeRank } from '@r10c/business-ts-authz';

import type { NavSection, NavTier } from './nav';

/**
 * Group sections into the sidebar's top tier — the screen type — preserving the
 * order sections were contributed in within each group.
 *
 * The tier is the **type** and the domain sits beneath it (ADR 0033). Four fixed
 * entries against eleven domains, so "where do I go to add a courier" has one
 * answer whoever owns couriers; the daily operator's speed is the command
 * palette's job rather than the sidebar's.
 *
 * Adjacent sections are **not** merged blindly — a host concatenates fragments
 * from several shells, and two shells can legitimately contribute `master`
 * sections that are not adjacent in the list. Grouping by rank rather than by
 * position is what keeps Definiciones one heading instead of three.
 *
 * There is no third level: a `NavItem` has no children, so the depth cap lives
 * in the type rather than in a convention. An arbitrary tree scans badly and
 * rots, and every case ADR 0022's eleven domains present fits three tiers.
 */
export function groupByScreenType(sections: NavSection[]): NavTier[] {
  const tiers: NavTier[] = [];

  for (const section of sections) {
    const tier = tiers.find(candidate => candidate.type === section.type);
    if (tier === undefined) {
      tiers.push({ type: section.type, sections: [section] });
      continue;
    }
    tier.sections.push(section);
  }

  // An untyped section sorts last — it is not a screen group, so it belongs
  // below the ones that are, never interleaved with them.
  return tiers.sort((a, b) => screenTypeRank(a.type) - screenTypeRank(b.type));
}
