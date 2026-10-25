import { serviceBaseRoutes } from '@r10c/shells-effect-service';
import { Layer } from 'effect';

import { sagaInstanceRoutes } from './saga/instance-routes';
import { sagaRoutes } from './saga/routes';
import { sagaRunRoutes } from './saga/run-routes';

/**
 * transaction-service routes. `/api/health*` and `/api/$service` are added by
 * the shell.
 *
 * Two surfaces, and they are different acts. The **reads** — a record by id and
 * the reactive stream — are what a browser watching its own pending write
 * polls and subscribes to; they moved here unchanged from
 * marketplace-admin-service when ADR 0039's `:3103` trigger fired (#229), and
 * both are authenticated and organization-scoped.
 *
 * `POST /api/saga/:definition` runs a declared multi-step flow. It is generic
 * rather than `/api/checkout` because this slice declares `domains: []` —
 * orchestration is a mechanism, and giving it a business verb would put a
 * domain name in a permission namespace nothing is provisioned for (ADR 0039).
 *
 * `GET /api/saga/:id` answers *where did this stop and what has been reversed*,
 * which is what ADR 0039 chose orchestration for and what nothing served until
 * the coordinator became resumable (#233). Session-guarded and scoped to the
 * organizations the flow's own calls named.
 */
export const router = Layer.mergeAll(
  // A literal, not `SERVICE_NAME`: `index.ts` re-exports this module, so
  // importing it back would read the constant before it is initialised.
  serviceBaseRoutes({ service: '@r10c/transaction-service', store: 'mongo' }),
  sagaRoutes,
  sagaRunRoutes,
  sagaInstanceRoutes,
);
