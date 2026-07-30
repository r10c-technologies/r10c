// Server-only surface, published as `@r10c/shells-next-system-management/server`.
//
// A separate entry so the proxy route handler is never reached through the client
// surface: stamped as a client module its `next/server` imports would fail. Same
// reason `shells-next-common` splits `/server`.

export * from './server/config-proxy-route';
