import { BackOfficeShell, type NavSection } from '@r10c/shells-next-common';
import type { ReactNode } from 'react';

// Primary navigation for the admin back office. Icons are plain glyphs so the
// config stays serializable across the server → client boundary.
const NAV: NavSection[] = [
  {
    title: 'Catalog',
    items: [
      { label: 'Products', href: '/catalog/product', icon: '▦' },
      { label: 'Brands', href: '/catalog/product-brand', icon: '◈' },
      { label: 'Categories', href: '/catalog/product-category', icon: '⊞' },
    ],
  },
  {
    title: 'Account',
    items: [{ label: 'Account', href: '/account', icon: '◕' }],
  },
];

const BREADCRUMB_LABELS: Record<string, string> = {
  catalog: 'Catalog',
  product: 'Products',
  'product-brand': 'Brands',
  'product-category': 'Categories',
  account: 'Account',
};

export default function BackOfficeLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <BackOfficeShell
      nav={NAV}
      brand="r10c Admin"
      breadcrumbLabels={BREADCRUMB_LABELS}
      homeLabel="Admin"
    >
      {children}
    </BackOfficeShell>
  );
}
