import type { EntifixFailure, NotFound, TechnicalFailure } from '@entifix/core';
import { Context, type Effect } from 'effect';

/**
 * Where an organization's WhatsApp number is read and written — and
 * announced, in the same unit: the storefront reads it from the published
 * vendor projection to offer the buyer a chat with the seller (#671). An empty
 * number is none.
 */
export class OrganizationWhatsappNumberTag extends Context.Service<
  OrganizationWhatsappNumberTag,
  {
    readonly get: (
      organizationId: string,
    ) => Effect.Effect<string, NotFound | TechnicalFailure>;
    readonly set: (
      organizationId: string,
      number: string,
    ) => Effect.Effect<void, NotFound | EntifixFailure>;
  }
>()('@r10c/party-management/OrganizationWhatsappNumber') {}
