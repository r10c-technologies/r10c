import { makeService } from '@entifix/service-shell/runtime';
import {
  endpoints,
  makeAppLayer,
  policy,
  streamRoutes,
} from '@r10c/shells-effect-realtime';
import { fleetToken } from '@r10c/utils-ts-fleet';

import { DEFAULT_PORT, SERVICE_NAME } from './index';

/**
 * realtime-service — what reaches a browser, and where a flow stands
 * (port 3191, behind the edge on every origin at `/api/realtime/*`).
 *
 * Owns the `flow-status` store, a projection of the workflow journal, and
 * serves the one push stream every tab opens. Every replica binds its own
 * `broadcast` queues, because each holds different connections; a browser
 * hears only what the audience filter admits for its session or its flow
 * capability, and an event naming no audience reaches nobody
 * ([ADR 0072](../../../docs/adr/0072-the-realtime-slice-flow-status-and-the-edge.md)).
 *
 * It presents no crossing token and accepts none: the stream and the flow
 * reads are answered from the caller's own verified session, or from a
 * capability compared by digest.
 */
makeService({
  name: SERVICE_NAME,
  port: Number(process.env.PORT) || DEFAULT_PORT,
  slices: ['realtime'],
  description: fleetToken,
  endpoints,
  policy,
  router: streamRoutes,
  appLayer: makeAppLayer(),
});
