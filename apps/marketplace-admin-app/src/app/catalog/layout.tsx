import Link from 'next/link';
import type { ReactNode } from 'react';

const NAV_ITEMS = [
  { href: '/catalog/product', label: 'Products' },
  { href: '/catalog/product-brand', label: 'Brands' },
  { href: '/catalog/product-category', label: 'Categories' },
];

export default function CatalogLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '16px' }}>
      <nav
        style={{
          display: 'flex',
          gap: 16,
          padding: '12px 0',
          marginBottom: 16,
          borderBottom: '1px solid var(--color-border, #ccc)',
        }}
      >
        <strong style={{ marginRight: 8 }}>Catalog</strong>
        {NAV_ITEMS.map(item => (
          <Link key={item.href} href={item.href}>
            {item.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
