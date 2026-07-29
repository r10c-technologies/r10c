import { createHealthRoutes } from '@r10c/shells-next-common/server';

const routes = createHealthRoutes({
  app: '@r10c/marketplace-admin-app',
  configApiUrl: process.env.CONFIG_API_URL ?? 'http://localhost:3190',
  configKey: 'marketplace-admin-app',
});

export async function GET() {
  return routes.ready();
}
