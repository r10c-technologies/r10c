import { can } from '@r10c/business-ts-authz';
import { AccountMenu, BackOfficeShell } from '@r10c/shells-next-common';
// From the server entry: this layout calls it directly, and the client entry
// would hand back a client reference rather than the function.
import { accountPaths } from '@r10c/shells-next-common/server';
import {
  getRequestLocale,
  getServerT,
  getServerTranslateKey,
} from '@r10c/shells-next-i18n/server';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { navFor } from '../../lib/nav';
import { loadPrincipal } from '../../lib/principal';
import { DEFAULT_REDIRECT } from '../../lib/session';

/**
 * The back-office gate. It runs on the server, after middleware has already
 * bounced anyone without a cookie, and does the check that actually matters
 * here: resolve the principal from auth-service and refuse anyone the policy
 * does not grant user management. A plain `user` is sent on to the admin app
 * rather than shown an empty shell.
 *
 * Deliberately not in `middleware.ts`: verifying the token at the edge would
 * mean copying `jwt.secret` out of config-service into the Next runtime, and
 * this layout needs the principal anyway to filter the nav.
 */
export default async function BackOfficeLayout({
  children,
}: {
  children: ReactNode;
}) {
  const principal = await loadPrincipal();
  if (principal === null) {
    redirect('/');
  }
  if (!can(principal.roles, 'authn:user-identity:read')) {
    redirect(DEFAULT_REDIRECT);
  }

  const locale = await getRequestLocale();
  const t = await getServerT('app');
  // Nav labels are keys held in a route table, so they need the widened form.
  // Unbound: the table carries its own `app:` / `shell:` prefixes.
  const translateKey = await getServerTranslateKey();

  return (
    <BackOfficeShell
      nav={navFor(principal.roles, translateKey)}
      brand={t('auth.brand')}
      breadcrumbLabels={{
        users: t('auth.nav.users'),
        new: t('auth.nav.newUser'),
        account: t('auth.account.title'),
      }}
      accountMenu={
        <AccountMenu label={principal.subject} items={accountPaths(locale)} />
      }
    >
      {children}
    </BackOfficeShell>
  );
}
