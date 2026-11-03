import { Layer } from 'effect';

import { FLOW_PATH, flowRoutes } from './flow-routes.js';
import { STREAM_PATH, streamRoutes } from './stream-route.js';

/**
 * Every route served beside the `HttpApi`: the held-open stream, which an
 * `HttpApi` does not describe, and the flow reads, which answer a session or a
 * capability and so fit no guard kind. Listed so `@r10c/slices` holds them to
 * the declaration exactly as it holds the endpoints.
 */
export const REALTIME_ROUTES = [
  `GET ${STREAM_PATH}`,
  `GET ${FLOW_PATH}`,
  `GET ${FLOW_PATH}/:id`,
] as const;

/** The router realtime-service mounts. */
export const realtimeRoutes = Layer.mergeAll(streamRoutes, flowRoutes);
