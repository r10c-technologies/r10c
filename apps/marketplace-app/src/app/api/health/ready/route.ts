import { createHealthRoutes } from '@entifix/next-shell/server';
import { configSourceFor } from '@r10c/utils-ts-fleet';

const routes = createHealthRoutes({
  app: '@r10c/marketplace-app',
  configuration: () => configSourceFor('marketplace-app'),
});

export async function GET() {
  return routes.ready();
}
