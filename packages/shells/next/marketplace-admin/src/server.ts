// Server-only surface, published as `@r10c/shells-next-marketplace-admin/server`.
//
// A separate entry for the same reason `shells-next-common` splits one: anything
// reachable from the package's main entry is stamped as a client module, and a
// declaration that reads `process.env` or that a route handler runs must not be.

// Where the two catalog backends listen. One default per service, shared by the
// proxies, `/api/me` and the record search fan-out.
export * from './server/service-urls';

// The catalog's records, as sources the command palette can search (ADR 0040).
export * from './server/search-sources';
