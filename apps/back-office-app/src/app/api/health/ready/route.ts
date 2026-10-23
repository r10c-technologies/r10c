import { createHealthRoutes } from '@entifix/next-shell/server';
import { configSourceFor } from '@r10c/utils-ts-fleet';

const routes = createHealthRoutes({
  app: '@r10c/back-office-app',
  configuration: () => configSourceFor('back-office-app'),
});

export async function GET() {
  return routes.ready();
}
