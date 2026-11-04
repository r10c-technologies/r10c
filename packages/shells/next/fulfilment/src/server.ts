// Server-only surface, published as `@r10c/shells-next-fulfilment/server`:
// anything reachable from the main entry is stamped a client module, and a
// declaration that reads `process.env` or that a route handler runs must not be.

export * from './server/search-sources';
export * from './server/service-urls';

// Contributed from here because a server layout composes it.
export { FULFILMENT_NAV } from './nav';
