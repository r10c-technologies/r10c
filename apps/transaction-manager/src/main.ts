import { makeService } from '@r10c/shells-effect-service';

import { AppLayer } from './mongo';
import { router } from './routes';

/**
 * transaction-manager — passive saga tracker, Effect-native (port 3103).
 *
 * Subscribes to the RabbitMQ transaction bus and records every transaction's
 * lifecycle in MongoDB, exposing it at `GET /api/transaction/:id` for clients to
 * poll. It never dispatches work — services choreograph their own transactions;
 * the manager only observes and flags stalls (recovery sweep). Mongo + RabbitMQ
 * settings are resolved from config-service at boot.
 */
makeService({
  name: '@r10c/transaction-manager',
  port: Number(process.env.PORT) || 3103,
  router,
  appLayer: AppLayer,
});
