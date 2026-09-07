import type { GuardedCommand } from '@r10c/business-ts-authz';
import { parseKeywords } from '@r10c/entifix-ts-core';
import { AUTH_COMMANDS } from '@r10c/shells-next-auth/server';
import type { PaletteCommand } from '@r10c/shells-next-common';
import { MARKETPLACE_ADMIN_COMMANDS } from '@r10c/shells-next-marketplace-admin/server';

import { isNavItemVisible } from './nav';
import type { NavPrincipal } from './nav-principal';

/**
 * **The** command-palette commands for the back office (ADR 0044).
 *
 * A concatenation rather than a list, for the reason `NAV` and `SEARCH_SOURCES`
 * are ones: each shell owns the screens its commands lead to, and only the host
 * sees every shell. Dropping a domain from this app is dropping a line here.
 *
 * The order is the order within the Comandos group before recency reorders it.
 *
 * `SYSTEM_MANAGEMENT_NAV` contributes none, and that is not an oversight:
 * `Configuration` rows are seeded settings including credentials, which is why
 * ADR 0040 kept them out of record search too. "New configuration parameter" is
 * not something anyone reaches for from a palette.
 */
export const COMMANDS: readonly GuardedCommand[] = [
  ...MARKETPLACE_ADMIN_COMMANDS,
  ...AUTH_COMMANDS,
];

/**
 * Keep only what `principal` may run, resolved into the palette's wire shape.
 *
 * The visibility rule is `isNavItemVisible` itself, not a second copy of it: a
 * command and a nav item are gated by the same two ceilings (ADR 0037), and two
 * filters that could disagree about the same permission is precisely the drift
 * the shared vocabulary exists to prevent.
 *
 * Filtering here is presentation. The route behind the command is what refuses
 * the request — a hidden command protects nothing.
 */
export const visibleCommands = (
  principal: NavPrincipal,
  translate: (key: string) => string,
): PaletteCommand[] =>
  COMMANDS.filter(command => isNavItemVisible(command, principal)).map(
    command => ({
      key: command.key,
      label: translate(command.labelKey),
      // Split here rather than in the browser, because this is where the catalog
      // is already being read and a `PaletteCommand` must be plain serializable
      // data to survive the crossing into the client palette.
      keywords: parseKeywords(
        command.keywordsKey === undefined
          ? undefined
          : translate(command.keywordsKey),
      ),
      href: command.href,
      ...(command.page === undefined ? {} : { page: command.page }),
    }),
  );
