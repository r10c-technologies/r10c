// Client-safe session helpers only.
//
// The cookie writers, the refresh route handler AND the account-link builders
// ship from `@r10c/shells-next-common/server` instead. The link builders are
// pure functions, but everything reachable from this entry is stamped
// `"use client"` by the bundler — so exporting them here turns a plain function
// call in a server layout into "Attempted to call accountUrls() from the server
// but accountUrls is on the client".
export * from './use-session-refresh';
