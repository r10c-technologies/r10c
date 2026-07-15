import { IdentityProviderTag } from '@r10c/business-ts-authn';
import { Layer } from 'effect';

import { makeStubIdentityProvider } from './identity/stub-identity-provider';

/**
 * Composition root — the whole dependency graph as Effect Layers. The real
 * Zitadel + Redis adapter drops in here (swap the stub); routes and bootstrap
 * stay untouched. This Layer is handed to the shared service base as `appLayer`.
 */
export const AppLayer = Layer.succeed(
  IdentityProviderTag,
  makeStubIdentityProvider()
);
