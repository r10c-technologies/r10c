// Server-only surface, published as `@r10c/shells-next-marketplace/server`.
//
// It stays a separate entry so Server Actions and anything touching
// `next/headers` are never reached through the client surface: stamped as
// client modules they would become client references and their server-only
// imports would fail. The library compiles per-file, so each module keeps its
// own `"use client"` (or keeps none, as almost everything here does) instead of
// inheriting a bundle-wide banner.
//
// Nearly the whole storefront lives on this side. That is the point of the
// iteration — the client entry beside it holds a single component.

// The pages themselves — every one a React server component.
export * from './lib/pages/cart-page';
export * from './lib/pages/category-page';
export * from './lib/pages/home-page';
export * from './lib/pages/product-page';
export * from './lib/pages/search-page';
export * from './lib/pages/store-shell';
export * from './lib/pages/storefront-skeleton';

// Chrome and catalog pieces, for a host that wants to compose its own page.
export * from './lib/catalog/product-card';
export * from './lib/catalog/product-grid';
export * from './lib/chrome/store-footer';
export * from './lib/chrome/store-header';

// Routing. `StoreLink` is a server component; `storePaths` is the one place a
// storefront URL is spelled out.
export * from './lib/routing/paths';
export * from './lib/routing/store-link';

// The read side: fixture-backed today, the same call sites once
// marketplace-service exists.
export * from './lib/catalog/queries';

// Cart state and its mutations.
export * from './lib/cart/cart-actions';
export * from './lib/cart/cart-cookie';
export * from './lib/cart/cart-state';
