import { UserIdentity } from '@r10c/business-ts-authn';
import {
  type GuardedNavSection,
  permissionForEntity,
} from '@r10c/business-ts-authz';
import { ACCOUNT_DESTINATIONS } from '@r10c/shells-next-common/server';

/** Presentation only, and this shell's to choose — the account list has none. */
const ACCOUNT_ICONS: Record<string, string> = {
  'account.profile': '◕',
  'account.security': '⚿',
  'account.sessions': '◎',
};

/**
 * This shell's contribution to a host's navigation, in the same shape
 * `SYSTEM_MANAGEMENT_NAV` uses — so a host concatenates rather than special-cases.
 *
 * The permission is derived from the entity rather than written out, so it
 * cannot drift from what auth-service enforces on the route behind it.
 * Filtering here is presentation: auth-service refuses the request.
 *
 * The account section is derived from the shell's `ACCOUNT_DESTINATIONS` rather
 * than written out again — this sidebar and the account menu are the same three
 * screens, and they were drifting as two hand-kept lists. No permission on any
 * of them: your own account is not an administrative screen, and a plain `user`
 * has to be able to reach it.
 */
export const AUTH_NAV: GuardedNavSection[] = [
  {
    title: 'shell:auth.nav.identity',
    // Definiciones: an operator authors the account, and a membership, a
    // session and an audit row all reference it (ADR 0033).
    type: 'master',
    items: [
      {
        label: 'shell:auth.nav.users',
        href: '/users',
        icon: '◉',
        permission: permissionForEntity(UserIdentity, 'read'),
      },
    ],
  },
  {
    // No `type`, and this is the one section entitled to none (ADR 0033): it is
    // the signed-in person's own account rather than a group of administrative
    // screens, which is the same reason none of its items carries a permission.
    title: 'shell:auth.nav.accountSection',
    items: ACCOUNT_DESTINATIONS.map(destination => ({
      label: `shell:${destination.labelKey}`,
      href: destination.path,
      icon: ACCOUNT_ICONS[destination.labelKey],
    })),
  },
];
