import { AccountMenu, BackOfficeShell } from '@r10c/shells-next-common';
// From the server entry: this layout calls it directly, and the client entry
// would hand back a client reference rather than the function.
import { accountUrls } from '@r10c/shells-next-common/server';
import {
  getRequestLocale,
  getServerT,
  getServerTranslateKey,
} from '@r10c/shells-next-i18n/server';
import type { ReactNode } from 'react';

import { sidebarNav } from '../../lib/nav';
import { navRoles } from '../../lib/roles';

/** auth-app owns every account screen; this app links across to it. */
const AUTH_APP_URL = process.env.AUTH_APP_URL ?? 'http://localhost:3002';

/**
 * The `BackOfficeShell` wrapper for every authenticated page — home, account,
 * catalog, and the workspace. `/workspace` renders `WorkspaceShell` inside it,
 * which is only a tab strip + body (no sidebar/top bar of its own), so nesting
 * never doubles the chrome.
 *
 * Renders only the nav entries the caller's roles grant. The definition lives
 * in `lib/nav` and is shared with `/api/menu`, so the sidebar and the workspace
 * menu cannot disagree.
 */
export default async function AuthenticatedLayout({
  children,
}: {
  children: ReactNode;
}) {
  const roles = await navRoles();
  const locale = await getRequestLocale();
  const t = await getServerT('app');
  // Nav labels are keys held in a route table, so they need the widened form.
  // Unbound: the table carries its own `app:` / `shell:` prefixes, because the
  // shell renders it but does not own all of its copy.
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
    account: t('admin.nav.account'),
  };

  return (
    <BackOfficeShell
      nav={sidebarNav(roles, translateKey)}
      brand={t('admin.brand')}
      breadcrumbLabels={breadcrumbLabels}
      accountMenu={
        <AccountMenu
          label={t('admin.nav.account')}
          items={accountUrls(AUTH_APP_URL, locale)}
          signOutRedirect={AUTH_APP_URL}
        />
      }
    >
      {children}
    </BackOfficeShell>
  );
}
