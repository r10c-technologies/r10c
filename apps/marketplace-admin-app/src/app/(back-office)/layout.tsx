import { BackOfficeShell } from '@r10c/shells-next-common';
import {
  getServerT,
  getServerTranslateKey,
} from '@r10c/shells-next-i18n/server';
import type { ReactNode } from 'react';

import { sidebarNav } from '../../lib/nav';
import { navRoles } from '../../lib/roles';

/**
 * Renders only the nav entries the caller's roles grant. The definition lives
 * in `lib/nav` and is shared with `/api/menu`, so the sidebar and the workspace
 * menu cannot disagree.
 */
export default async function BackOfficeLayout({
  children,
}: {
  children: ReactNode;
}) {
  const roles = await navRoles();
  const t = await getServerT('app');
  // Nav labels are keys held in a route table, so they need the widened form.
  const translateKey = await getServerTranslateKey('app');

  // Crumb labels are keyed by URL segment, which is a routing token — the shell
  // cannot know which namespace an app keeps its route names in, so the host
  // resolves them.
  const breadcrumbLabels: Record<string, string> = {
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
      homeLabel={t('admin.home')}
    >
      {children}
    </BackOfficeShell>
  );
}
