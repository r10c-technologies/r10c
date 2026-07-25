/**
 * Liveness for the app itself — no config-service, no backend, no session, so
 * it answers as soon as Next is listening.
 *
 * That is precisely why it exists: with the whole app behind the auth
 * middleware, a readiness probe against `/` gets a redirect to an auth-app that
 * may not be running, and one against `/api/config` gets a 500 until
 * config-service is up. Playwright's `webServer.url` points here.
 */
export function GET() {
  return Response.json({ status: 'ok', app: '@r10c/marketplace-admin-app' });
}
