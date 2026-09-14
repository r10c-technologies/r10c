import { createHealthRoutes } from '@entifix/next-shell/server';

const routes = createHealthRoutes({
  app: '@r10c/back-office-app',
  configApiUrl: process.env.CONFIG_API_URL ?? 'http://localhost:3190',
  configKey: 'back-office-app',
});

export async function GET() {
  return routes.ready();
}
