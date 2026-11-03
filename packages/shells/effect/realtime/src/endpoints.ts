import {
  fleetFailurePolicy,
  serviceBaseGroup,
} from '@r10c/shells-effect-service';

/**
 * The `realtime` slice's endpoints, served as one `HttpApi` by `makeService`
 * ([ADR 0071](../../../../../docs/adr/0071-http-cells-hold-descriptors-and-the-slice-shell-builds-the-api.md)).
 * The stream itself is not among them: a held-open response is not something
 * an `HttpApi` describes, so it is a router route (`streamRoutes`).
 */
export const endpoints = [
  serviceBaseGroup({ service: '@r10c/realtime-service', store: 'mongo' }),
] as const;

/** How this slice's endpoints answer and log a failure (ADR 0064). */
export const policy = fleetFailurePolicy;
