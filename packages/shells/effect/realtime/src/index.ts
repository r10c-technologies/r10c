/**
 * The `realtime` slice's shell: the push stream every tab opens through the
 * edge, the broadcast queues that feed it, and the projections deciding what a
 * browser may hear. realtime-service only mounts it (ADR 0064, ADR 0072).
 */
export { makeAppLayer, readPushDials, realtimeComposition } from './app-layer.js';
export {
  type Caller,
  CAPABILITY_PARAM,
  identifies,
  MAX_CAPABILITIES,
  resolveCaller,
} from './caller.js';
export { endpoints, policy } from './endpoints.js';
export {
  FLOW_PATH,
  flowRoutes,
  flowStatusHandler,
  flowStatusListHandler,
  MAX_FLOW_IDS,
} from './flow-routes.js';
export {
  FLOW_STATUS_SUBSCRIPTION,
  logFlowStatus,
  startFlowStatusProjection,
} from './flow-status-subscription.js';
export {
  PRODUCT_OFFERING,
  PRODUCT_ORDER,
  PUSH_ENTITIES,
  PUSH_PROJECTIONS,
  type Pushed,
  type PushEntity,
  type PushGate,
  type PushProjection,
} from './push-projections.js';
export {
  pushSubscription,
  REALTIME_SLICE,
  startPushSubscriptions,
} from './push-subscriptions.js';
export {
  admitsVariant,
  makeRealtimePush,
  type RealtimeConnection,
  type RealtimePush,
  RealtimePushLayer,
  type RealtimePushOptions,
  RealtimePushTag,
  routedTopics,
} from './realtime-push.js';
export { REALTIME_ROUTES, realtimeRoutes } from './routes.js';
export {
  MAX_TOPICS,
  STREAM_PATH,
  streamHandler,
  streamRoutes,
} from './stream-route.js';
