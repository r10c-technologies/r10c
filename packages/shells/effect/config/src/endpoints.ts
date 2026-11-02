import { endpointGroup, entityApi } from '@entifix/service-shell';
import {
  configurationApi,
  configurationLookupEndpoints,
} from '@r10c/implementation-configuration-http';
import { fleetFailurePolicy } from '@r10c/shells-effect-service';

/**
 * The `config` slice's endpoints, served as one `HttpApi` by `makeService`
 * ([ADR 0071](../../../../../docs/adr/0071-http-cells-hold-descriptors-and-the-slice-shell-builds-the-api.md)).
 * Health, `$service` and `$openapi` are added by the service runtime.
 *
 * - `/api/config…` — the fleet's lookup and the store's introspection, behind
 *   the shared fleet token, with real values.
 * - `/api/configuration…` — the operator-facing CRUD, behind
 *   `config:configuration:*`, blanking secrets.
 *
 * This slice serves no `serviceBaseGroup`: its own `GET /api/config` is the
 * introspection, and config-service has no configuration of its own to
 * redact but the rows it serves.
 */
export const endpoints = [
  endpointGroup('config', ...configurationLookupEndpoints),
  entityApi(configurationApi),
] as const;

/** How this slice's endpoints answer and log a failure (ADR 0064). */
export const policy = fleetFailurePolicy;
