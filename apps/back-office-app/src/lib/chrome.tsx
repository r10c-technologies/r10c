import { AccountMenu, BackOfficeShell } from '@r10c/shells-next-common';
// From the server entry: this module calls them directly, and the client entry
// would hand back a client reference rather than the function.
import { accountPaths } from '@r10c/shells-next-common/server';
import {
  getRequestLocale,
  getServerT,
  getServerTranslateKey,
} from '@r10c/shells-next-i18n/server';
import type { ReactNode } from 'react';

import { sidebarNav } from './nav';
import { navPrincipal } from './nav-principal';

/**
 * The back-office chrome, shared by all three route groups.
 *
 * There are three because they gate differently, not because they look
 * different: `(authenticated)` needs only a session, `(back-office)` also
 * demands `authn:user-identity:read`, and `(account)` deliberately demands
 * nothing beyond a session — your own account is not an administrative screen,
 * and a plain `user` has to reach it. Composing the shell once here is what
 * keeps that a difference in gates rather than three drifting copies of the
 * same layout.
 *
 * `accountPaths` rather than `accountUrls`: the account screens are served by
 * this host now, so the menu links to paths on this origin instead of across to
 * an app on another port.
 */
export async function BackOfficeChrome({
  children,
  label,
}: {
  children: ReactNode;
  /** Shown in the account menu. The principal's subject where one is loaded. */
  label?: string;
}) {
  const principal = await navPrincipal();
  const locale = await getRequestLocale();
  const t = await getServerT('app');
  // Nav labels are keys held in a route table, so they need the widened form.
  // Unbound: the table carries its own `app:` / `shell:` prefixes, because this
  // host renders copy owned by three different packages.
  const translateKey = await getServerTranslateKey();

  // Crumb labels are keyed by URL segment, which is a routing token — the shell
  // cannot know which namespace an app keeps its route names in, so the host
  // resolves them.
  const breadcrumbLabels: Record<string, string> = {
    home: t('admin.nav.dashboard'),
    catalog: t('admin.nav.catalog'),
    product: t('admin.nav.products'),
    'product-brand': t('admin.nav.brands'),
    'product-category': t('admin.nav.categories'),
    // Owned by the shells that render these screens, so the keys carry their
    // namespace rather than living in this app's catalog.
    system: translateKey('shell:systemManagement.nav.section'),
    configuration: translateKey('shell:systemManagement.nav.configuration'),
    users: translateKey('shell:auth.nav.users'),
    // Generic on purpose: `/new` is every domain's create route, so a
    // domain-specific label here reads wrong on the other one's pages.
    new: translateKey('shell:breadcrumbs.new'),
    account: translateKey('shell:auth.account.title'),
    security: translateKey('shell:auth.security.title'),
    sessions: translateKey('shell:auth.sessions.title'),
  };

  return (
    <BackOfficeShell
      nav={sidebarNav(principal, translateKey)}
      brand={t('admin.brand')}
      breadcrumbLabels={breadcrumbLabels}
      accountMenu={
        <AccountMenu
          label={label ?? translateKey('shell:auth.account.menu')}
          items={accountPaths(locale)}
        />
      }
    >
      {children}
    </BackOfficeShell>
  );
}
