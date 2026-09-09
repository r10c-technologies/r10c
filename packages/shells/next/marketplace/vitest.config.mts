import { defineEntifixTest } from '../../../../vitest.shared.mjs';

export default defineEntifixTest({
  name: '@r10c/shells-next-marketplace',
  root: __dirname,
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
    '**/lib/catalog/offering-card.tsx',
    '**/lib/catalog/offering-grid.tsx',
    '**/lib/routing/store-link.tsx',
    '**/lib/cart/cart-cookie.ts',
    '**/lib/cart/cart-actions.ts',
    // Same reason as `cart-cookie`: one `cookies()` read and nothing else. Its
    // parsing — which is the part with decisions in it — lives in
    // `receipt-state.ts` and is covered directly.
    '**/lib/cart/receipt-cookie.ts',
  ],
});
