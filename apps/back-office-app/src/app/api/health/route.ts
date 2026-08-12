import { createHealthRoutes } from '@r10c/shells-next-common/server';

/**
 * Probe endpoints for this app, mirroring the backends' `/api/health*`.
 *
 * Liveness answers as soon as Next is listening — no config-service, no
 * backend, no session. That is precisely why it exists: with the whole app
 * behind the auth middleware, a probe against `/` gets a redirect to an
 * sign-in page rather than a rendered route. Playwright's `webServer.url` points here.
 */
const routes = createHealthRoutes({
  app: '@r10c/back-office-app',
  configApiUrl: process.env.CONFIG_API_URL ?? 'http://localhost:3190',
  configKey: 'back-office-app',
});

export function GET() {
  return routes.health();
}
