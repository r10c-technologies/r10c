import { BackOfficeShell } from '@r10c/shells-next-common';
import type { ReactNode } from 'react';

import { sidebarNav } from '../../lib/nav';
import { navRoles } from '../../lib/roles';

const BREADCRUMB_LABELS: Record<string, string> = {
  catalog: 'Catalog',
  product: 'Products',
  'product-brand': 'Brands',
  'product-category': 'Categories',
  account: 'Account',
};

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

  return (
    <BackOfficeShell
      nav={sidebarNav(roles)}
      brand="r10c Admin"
      breadcrumbLabels={BREADCRUMB_LABELS}
      homeLabel="Admin"
    >
      {children}
    </BackOfficeShell>
  );
}
