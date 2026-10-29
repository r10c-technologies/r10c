import { RequestPrincipalTag } from '@entifix/business';
import { defineEndpoint, implement, JsonBody } from '@entifix/core';
import { endpointGroup, redactConfiguration } from '@entifix/service-shell';
import { LoadedConfigurationTag } from '@entifix/service-shell/runtime';
import { Effect, Schema } from 'effect';

const configEndpoint = defineEndpoint({
  name: 'config',
  method: 'GET',
  path: '/api/config',
  success: Schema.Struct({
    service: Schema.String,
    store: Schema.Literals(['mongo', 'sql']),
    configuration: JsonBody,
  }),
  errors: [],
  guard: { kind: 'public' },
});

const meEndpoint = defineEndpoint({
  name: 'me',
  method: 'GET',
  path: '/api/me',
  success: JsonBody,
  errors: [],
  guard: { kind: 'session' },
});

/**
 * The two endpoints every r10c service serves beside its own
 * ([ADR 0071](../../../../../docs/adr/0071-http-cells-hold-descriptors-and-the-slice-shell-builds-the-api.md)):
 *
 * - `GET /api/config` — this service's loaded parameters, with every credential
 *   redacted. Public, which is exactly why an `is_secret` row is the security
 *   boundary rather than a label.
 * - `GET /api/me` — the caller's verified principal, which is how a downstream
 *   service proves it trusts the token auth-service minted. An empty or
 *   unverifiable credential answers a `401` problem.
 *
 * Health, `$service` and `$openapi` come from the framework's base.
 */
export const serviceBaseGroup = (options: {
  readonly service: string;
  readonly store: 'mongo' | 'sql';
}) =>
  // Not `service`: that name is the framework's own health and `$service` group.
  endpointGroup(
    'fleet',
    implement(configEndpoint, () =>
      Effect.map(LoadedConfigurationTag, plain => ({
        service: options.service,
        store: options.store,
        configuration: redactConfiguration(plain),
      })),
    ),
    implement(meEndpoint, () => Effect.service(RequestPrincipalTag)),
  );
