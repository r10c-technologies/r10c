import { endpointGroup } from '@entifix/service-shell';
import {
  fleetFailurePolicy,
  serviceBaseGroup,
} from '@r10c/shells-effect-service';

import { flowStartEndpoints } from './flow/flow-endpoints.js';
import { sagaEndpoints } from './saga/saga-endpoints.js';

/**
 * The `transaction` slice's endpoints, served as one `HttpApi` by
 * `makeService` ([ADR 0071](../../../../docs/adr/0071-http-cells-hold-descriptors-and-the-slice-shell-builds-the-api.md)).
 * Health, `$service` and `$openapi` are added by the service runtime.
 *
 * The coordinator's surface: a start per recipe behind its own crossing
 * permission, answered `202` (ADR 0066).
 */
export const endpoints = [
  serviceBaseGroup({ service: '@r10c/transaction-service', store: 'mongo' }),
  endpointGroup('flow', ...flowStartEndpoints),
  endpointGroup('saga', ...sagaEndpoints),
] as const;

/** How this slice's endpoints answer and log a failure (ADR 0064). */
export const policy = fleetFailurePolicy;
