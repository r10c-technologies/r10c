import { makeAppLayer } from '@r10c/shells-effect-realtime';

export {
  endpoints,
  policy,
  REALTIME_SLICE,
  realtimeRoutes,
} from '@r10c/shells-effect-realtime';

/** The slice's composition, as the service mounts it. */
export const AppLayer = makeAppLayer();

export const SERVICE_NAME = '@r10c/realtime-service';

/**
 * `319x` — a cross-cutting platform service beside config-service
 * (`docs/_shared/ports.md`). Reserved by ADR 0072, and claimed by the commit
 * that wrote the `realtime` slice's service.
 */
export const DEFAULT_PORT = 3191;
