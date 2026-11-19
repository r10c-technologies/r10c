import type { EntifixFailure, NotFound, TechnicalFailure } from '@entifix/core';
import { Context, type Effect } from 'effect';

/**
 * Where an organization's choice to take payment links is read and written —
 * and announced, in the same unit: the published vendor projection is what the
 * checkout reads `acceptsLink` from (ADR 0081 §1), so a write that did not
 * announce would keep offering, or keep refusing, the link tender.
 */
export class OrganizationPaymentLinkAcceptanceTag extends Context.Service<
  OrganizationPaymentLinkAcceptanceTag,
  {
    readonly get: (
      organizationId: string,
    ) => Effect.Effect<boolean, NotFound | TechnicalFailure>;
    readonly set: (
      organizationId: string,
      accepts: boolean,
    ) => Effect.Effect<void, NotFound | EntifixFailure>;
  }
>()('@r10c/party-management/OrganizationPaymentLinkAcceptance') {}
