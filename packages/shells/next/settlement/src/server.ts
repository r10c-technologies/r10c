// Server-only surface, published as `@r10c/shells-next-settlement/server`.
//
// A separate entry for the same reason the other shells split one: anything
// reachable from the package's main entry is stamped as a client module, and a
// declaration that reads `process.env` or that a route handler runs must not be.

export { SETTLEMENT_NAV } from './nav';
export * from './server/search-sources';
export * from './server/service-urls';
