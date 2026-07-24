import { NextResponse } from 'next/server';

/**
 * The workspace navigation menu. Hardcoded for now (a config-service-backed
 * source can replace it later) — the client fills its nav from this, showing a
 * skeleton until it arrives.
 */
export function GET() {
  return NextResponse.json({
    sections: [
      {
        title: 'Catalog',
        items: [
          { label: 'Products', param: 'catalog:product' },
          { label: 'Brands', param: 'catalog:product-brand' },
          { label: 'Categories', param: 'catalog:product-category' },
        ],
      },
    ],
  });
}
