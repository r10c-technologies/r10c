// Client surface, published as `@r10c/shells-next-marketplace`.
//
// Deliberately almost empty: a storefront's job is to arrive as HTML, so a
// component earns a place here only by needing something the server does not
// have — the cart badge, which reads a cookie a prerendered page could not
// have known, and the capabilities the push channel presents for the flows a
// page waits on (ADR 0072).
//
// Everything else ships from `/server`.

export * from './lib/cart/cart-badge';
export * from './lib/cart/flow-capabilities';
