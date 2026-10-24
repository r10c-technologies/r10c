import { defineEntifixTest } from '../../../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@r10c/shells-next-marketplace',
  root: import.meta.dirname,
  environment: 'jsdom',
  // The storefront's components are React **server** components, most of them
  // `async`. This runner is plain jsdom + SWC with no RSC support, so rendering
  // one is not a coverage problem to solve but something the setup genuinely
  // cannot do — and `cart-actions`/`cart-cookie` reach for `next/headers`,
  // which only exists inside a request. All of it is covered end to end by
  // `marketplace-app-e2e`, which drives the real production build in a browser.
  //
  // Everything the gate can reach — the cart's wire format, the price
  // formatting, the queries (over msw, through the real REST adapters), the
  // paths, and the one client island — stays at 100%.
  coverageExclude: [
    '**/lib/pages/**',
    '**/lib/chrome/**',
    '**/lib/catalog/offering-grid.tsx',
    // The search composition: an async server component like the grid. Its
    // decisions are the codec's and the facets', covered at 100% in
    // `marketplace-catalog/next`; this file wires them to the page.
    '**/lib/catalog/offering-listing.tsx',
    // A product page's reads and each route's metadata: compositions of cell
    // reads through the module-level runner, like the pages. What they decide
    // is pure and covered here (`page-metadata`, `product-json-ld`); that they
    // reach the page is `marketplace-app-e2e`'s metadata journeys.
    '**/lib/catalog/product-read.ts',
    '**/lib/seo/route-metadata.ts',
    // The proxy's lookup, composed the same way; its memo and its path parsing
    // are `catalog-slug.ts`, covered here, and the 404 it produces is e2e's.
    '**/lib/routing/catalog-slug-exists.ts',
    '**/lib/routing/store-link.tsx',
    '**/lib/cart/cart-cookie.ts',
    '**/lib/cart/cart-actions.ts',
    // Same reason as `cart-cookie`: one `cookies()` read and nothing else. Its
    // parsing — which is the part with decisions in it — lives in
    // `receipt-state.ts` and is covered directly.
    '**/lib/cart/receipt-cookie.ts',
    // Same reason as `cart-actions`: a `'use server'` module that reads
    // `cookies()` and ends in a `redirect`, neither of which exists outside a
    // request. The decision it contains — whether a cancel may be offered at
    // all — is `cancel-window.ts`, which is covered directly.
    '**/lib/cart/cancel-action.ts',
  ],
});
