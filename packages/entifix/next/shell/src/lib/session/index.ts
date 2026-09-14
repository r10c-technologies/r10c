// Client-safe session helpers only.
//
// The cookie writers, the refresh route handler AND the account-link builders
// ship from `@entifix/next-shell/server` instead. The link builders are
// pure functions, but everything reachable from this entry is stamped
// `"use client"` by the bundler — so exporting them here turns a plain function
// call in a server layout into "Attempted to call accountPaths() from the
// server but accountPaths is on the client".
export * from './session-keepalive';
export * from './use-session-refresh';
