// Server-only surface, published as `@r10c/shells-next-sales/server`.
//
// A separate entry for the same reason the other shells split one: anything
// reachable from the package's main entry is stamped as a client module, and a
// declaration that reads `process.env` or that a route handler runs must not be.

// Where sales-service listens. One default, shared by the proxy and the search
// fan-out.
export * from './server/service-urls';

// The channels, as sources the command palette can search (ADR 0040).
export * from './server/search-sources';

// The permission-annotated nav, contributed beside the search sources so a host
// that mounts this shell gains both together. It ships from here because a
// server layout composes it, and anything reachable from the main entry is
// stamped a client reference.
export { SALES_NAV } from './nav';
