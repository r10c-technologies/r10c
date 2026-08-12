import { loadPrincipal, navFor } from '@r10c/shells-next-auth/server';
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

/**
 * The account surface's gate — a session, and nothing more.
 *
 * Deliberately NOT the `(back-office)` layout, which additionally demands
 * `authn:user-identity:read` and sends everyone else to the admin app. Your own
 * account is not an administrative screen: a plain `user` has to be able to see
 * their profile, change their password and end their sessions. Sharing that
 * layout would have locked every non-admin out of their own account.
 */
export default async function AccountLayout({
  children,
}: {
  children: ReactNode;
}) {
  const principal = await loadPrincipal();
  if (principal === null) {
    redirect('/');
  }

  const locale = await getRequestLocale();
  const t = await getServerT('app');
  // Unbound: the nav table carries its own `app:` / `shell:` prefixes.
  const translateKey = await getServerTranslateKey();

  return (
    <BackOfficeShell
      nav={navFor(principal.roles, translateKey)}
      brand={t('auth.brand')}
      breadcrumbLabels={{ account: t('auth.account.title') }}
      accountMenu={
        <AccountMenu label={principal.subject} items={accountPaths(locale)} />
      }
    >
      {children}
    </BackOfficeShell>
  );
}
