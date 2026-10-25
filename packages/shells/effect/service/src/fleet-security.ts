import {
  makeStaticPolicyDecision,
  PolicyDecisionTag,
  ServiceCrossingPolicyTag,
} from '@entifix/authz';
import { ConfigurationRepositoryTag, TokenServiceTag } from '@entifix/business';
import { makeJoseTokenService } from '@entifix/jwt';
import { ServiceCrossingTokenTag } from '@entifix/service-shell';
import { LoadedConfigurationTag } from '@entifix/service-shell/runtime';
import {
  AUTH_TOKEN_AUDIENCE,
  AUTH_TOKEN_ISSUER,
} from '@r10c/business-ts-authn';
import {
  r10cServiceCrossingPolicy,
  ROLE_PERMISSIONS,
} from '@r10c/business-ts-authz-grants';
import { Effect, Layer } from 'effect';

import type { FleetConfiguration } from './fleet-service.js';

/**
 * What every service that verifies a session provides, from its own
 * configuration:
 *
 * - the access-token **verifier** — the public half of `jwt` only, so a
 *   service that verifies tokens holds no material that can sign one;
 * - r10c's grant table and crossing policy, so a grant comes from
 *   `ROLE_PERMISSIONS` and never from the token;
 * - the configuration itself, for `GET /api/config`.
 *
 * auth-service is the one service that signs, and composes its own token
 * service instead of this one.
 */
export const fleetSecurityLayer = ({ plain, store }: FleetConfiguration) =>
  Effect.gen(function* () {
    const publicKeyPem = yield* store.in('jwt').getString('publicKey');
    const keyId = yield* store.in('jwt').getString('keyId');

    return Layer.mergeAll(
      Layer.succeed(
        TokenServiceTag,
        makeJoseTokenService({
          publicKeyPem,
          keyId,
          issuer: AUTH_TOKEN_ISSUER,
          audience: AUTH_TOKEN_AUDIENCE,
        }),
      ),
      fleetPolicyLayer({ plain, store }),
    );
  });

/**
 * The grant table, the crossing policy and the loaded configuration, without a
 * verifier — for a service that brings its own token service.
 */
export const fleetPolicyLayer = ({ plain, store }: FleetConfiguration) =>
  Layer.mergeAll(
    Layer.succeed(ConfigurationRepositoryTag, store),
    Layer.succeed(LoadedConfigurationTag, plain),
    Layer.succeed(
      PolicyDecisionTag,
      makeStaticPolicyDecision(ROLE_PERMISSIONS),
    ),
    Layer.succeed(ServiceCrossingPolicyTag, r10cServiceCrossingPolicy),
  );

/**
 * The crossing token this service **accepts**, from its own `service.token`
 * row.
 *
 * ⚠️ Each participant's token is its own `is_secret` row with its own
 * rotation, never the fleet's `CONFIG_SERVICE_TOKEN`: one leaked secret must
 * not reach two stores (ADR 0023).
 */
export const crossingTokenLayer = ({ store }: FleetConfiguration) =>
  Effect.map(store.in('service').getString('token'), token =>
    Layer.succeed(ServiceCrossingTokenTag, token),
  );
