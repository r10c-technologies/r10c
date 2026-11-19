import type { EntifixFailure, NotFound, TechnicalFailure } from '@entifix/core';
import { Context, type Effect } from 'effect';

import type { FiscalIdentity } from '../values/fiscal-identity';

/**
 * Where an organization's fiscal identity is read and written — and announced, in the
 * same unit: the published vendor projection is what the checkout copies it
 * from, so a write that did not announce would leave every new order carrying
 * the old identity.
 */
export class OrganizationFiscalIdentityTag extends Context.Service<
  OrganizationFiscalIdentityTag,
  {
    /** The organization's stated identity; `undefined` while it has none. */
    readonly get: (
      organizationId: string,
    ) => Effect.Effect<FiscalIdentity | undefined, NotFound | TechnicalFailure>;
    readonly set: (
      organizationId: string,
      identity: FiscalIdentity,
    ) => Effect.Effect<void, NotFound | EntifixFailure>;
  }
>()('@r10c/party-management/OrganizationFiscalIdentity') {}
