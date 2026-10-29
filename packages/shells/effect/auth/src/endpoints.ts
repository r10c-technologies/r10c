import { endpointGroup, entityApi } from '@entifix/service-shell';
import {
  authFlowEndpoints,
  entityIdentifierApi,
  sessionEndpoints,
  userIdentityApi,
  userSessionEndpoints,
} from '@r10c/implementation-authn-http';
import {
  fleetFailurePolicy,
  serviceBaseGroup,
} from '@r10c/shells-effect-service';

/**
 * The `auth` slice's endpoints, served as one `HttpApi` by `makeService`
 * ([ADR 0071](../../../../../docs/adr/0071-http-cells-hold-descriptors-and-the-slice-shell-builds-the-api.md)).
 * Health, `$service` and `$openapi` are added by the service runtime.
 *
 * The flow answers JSON — tokens and the principal — and the Next app turns
 * that into httpOnly cookies, so this service needs no cookie or CORS
 * handling. What the cell needs from this host — the identity provider's
 * ports over Zitadel, the published key set, the development mailbox — is
 * bound in `AuthnHostLayer`.
 */
export const endpoints = [
  serviceBaseGroup({ service: '@r10c/auth-service', store: 'mongo' }),
  endpointGroup('auth-flow', ...authFlowEndpoints),
  endpointGroup('auth-sessions', ...sessionEndpoints),
  entityApi(userIdentityApi),
  entityApi(entityIdentifierApi),
  endpointGroup('user-sessions', ...userSessionEndpoints),
] as const;

/** How this slice's endpoints answer and log a failure (ADR 0064). */
export const policy = fleetFailurePolicy;
