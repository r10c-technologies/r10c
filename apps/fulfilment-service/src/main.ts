import { makeService } from '@entifix/service-shell/runtime';
import {
  endpoints,
  makeAppLayer,
  policy,
} from '@r10c/shells-effect-fulfilment';
import { fleetToken } from '@r10c/utils-ts-fleet';

import { DEFAULT_PORT, SERVICE_NAME } from './index';

/**
 * fulfilment-service — a vendor order's journey to the buyer (port 3110).
 *
 * Owns the `fulfilment` store: tenant plane, one Mongo database per
 * organization (`fulfilment_<organizationId>`), a fourth beside the catalog's,
 * stock's and sales'. A shipment opens once its checkout commits, is held or
 * withdrawn by a cancellation, dispatched as the delivery flow's pivot, and
 * closed by what the vendor records from the courier (ADR 0070).
 */
makeService({
  name: SERVICE_NAME,
  port: Number(process.env.PORT) || DEFAULT_PORT,
  slices: ['fulfilment'],
  description: fleetToken,
  endpoints,
  policy,
  appLayer: makeAppLayer(),
});
