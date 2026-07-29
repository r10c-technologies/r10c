// Server-only surface, published as `@r10c/shells-next-common/server`.
//
// It has its own rollup entry so it escapes the `"use client"` banner the main
// bundle carries: route handlers and cookie helpers stamped as client modules
// would become client references and their `next/server` imports would fail.

// React server components
export * from './lib/hello-server';

// Probe route handlers (liveness/readiness) shared by every Next app.
export * from './lib/health/health-routes';

// Session cookies + the shared refresh route handler
export * from './lib/session/cookies';
export * from './lib/session/refresh-route';

// Account-link builders. Pure functions, but server layouts call them directly,
// and anything exported from the client entry becomes a client function.
export * from './lib/session/account-links';

// Device identity — read from the request, written onto the response.
export * from './lib/session/device';
