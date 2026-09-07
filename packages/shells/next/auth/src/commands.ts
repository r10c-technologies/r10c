import { UserIdentity } from '@r10c/business-ts-authn';
import {
  type GuardedCommand,
  NEW_COMMAND_PAGE,
  permissionForEntity,
} from '@r10c/business-ts-authz';

/**
 * This shell's contribution to a host's command palette, beside `AUTH_NAV`.
 *
 * One entry, and it is the create route this shell already serves at
 * `/users/new`. The permission is `write` rather than `read`: the command opens
 * a form for a record that does not exist, so offering it to someone who may
 * only look is an invitation to a `403`.
 *
 * No command for the account screens. They are destinations rather than acts —
 * the nav source already reaches every one of them — and a command that only
 * navigates somewhere the sidebar already lists is a second row for one thing.
 */
export const AUTH_COMMANDS: GuardedCommand[] = [
  {
    key: 'new:user-identity',
    // The shell's own page title, not an `entity:` key: this screen is
    // hand-written rather than generated, so `UserIdentity` declares no
    // `form.newTitle` — and inventing one to satisfy a convention would leave
    // two names for the same heading, free to drift.
    labelKey: 'shell:auth.users.newTitle',
    href: '/users/new',
    page: NEW_COMMAND_PAGE,
    permission: permissionForEntity(UserIdentity, 'write'),
  },
];
