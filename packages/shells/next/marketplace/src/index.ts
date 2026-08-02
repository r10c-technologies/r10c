// Client surface, published as `@r10c/shells-next-marketplace`.
//
// Deliberately almost empty: a storefront's job is to arrive as HTML, so a
// component earns a place here only by needing something the server does not
// have. Today exactly one does — the cart badge, which must read a cookie that
// a prerendered page could not have known.
//
// Everything else ships from `/server`.

export * from './lib/cart/cart-badge';
