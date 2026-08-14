// Server-only surface, published as `@r10c/shells-next-common/server`.
//
// It stays a separate entry so route handlers and cookie helpers are never
// reached through the client surface: stamped as client modules they would
// become client references and their `next/server` imports would fail. The
// library compiles per-file, so each module keeps its own `"use client"` (or
// keeps none, as here) instead of inheriting a bundle-wide banner.

// React server components
export * from './lib/hello-server';

// Probe route handlers (liveness/readiness) shared by every Next app.
export * from './lib/health/health-routes';

// The `GET /api/config` handler + the same-origin domain rewrite it applies.
export * from './lib/config/config-route';

// The same-origin proxy each host mounts per backend it talks to.
export * from './lib/config/service-proxy-route';

// Session cookies + the shared refresh route handler
export * from './lib/session/cookies';
export * from './lib/session/refresh-route';

// Account-link builders. Pure functions, but server layouts call them directly,
// and anything exported from the client entry becomes a client function.
export * from './lib/session/account-links';

// Device identity — read from the request, written onto the response.
export * from './lib/session/device';
