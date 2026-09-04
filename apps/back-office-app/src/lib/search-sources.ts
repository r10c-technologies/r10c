import { AUTH_SEARCH_SOURCES } from '@r10c/shells-next-auth/server';
import type { RecordSearchSource } from '@r10c/shells-next-common/server';
import { MARKETPLACE_ADMIN_SEARCH_SOURCES } from '@r10c/shells-next-marketplace-admin/server';

/**
 * **The** record search sources for the back office (ADR 0040).
 *
 * A concatenation rather than a list, for the same reason `NAV` is one: each
 * shell owns the screens its records route to, and only the host sees every
 * shell. Dropping a domain from this app is dropping a line here — the shell
 * keeps its own declaration, ready for whichever host mounts it next.
 *
 * **Order is the ranking.** The palette presents groups exactly like this, and
 * a fixed order is a deliberate choice over relevance scoring: an operator
 * learns where a kind of record lands, which a score across four unrelated
 * entities cannot offer and would reshuffle on every keystroke.
 *
 * `Configuration` is not here, though this host proxies config-service and the
 * permission would keep it to operators. Its rows are settings, including
 * credentials, and a palette is a broad surface to put them on for a
 * convenience nobody has asked for.
 */
export const SEARCH_SOURCES: readonly RecordSearchSource[] = [
  ...MARKETPLACE_ADMIN_SEARCH_SOURCES,
  ...AUTH_SEARCH_SOURCES,
];
