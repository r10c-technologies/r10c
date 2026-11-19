import { permissionForUseCase } from '@entifix/authz';
import { type EntifixFailure, NotFound, useCase } from '@entifix/core';
import { Effect, Schema } from 'effect';

import { Organization } from '../../entities/organization';
import { OrganizationPaymentLinkAcceptanceTag } from '../../ports/organization-payment-link-acceptance';

/** What `set-payment-link-acceptance` accepts. */
export const PaymentLinkAcceptancePayload = Schema.Struct({
  accepts: Schema.Boolean,
});

export type PaymentLinkAcceptancePayload =
  typeof PaymentLinkAcceptancePayload.Type;

/**
 * The organization says whether it takes payment by a link it sends the buyer
 * (ADR 0081 §1). Authored by the organization itself, never provisioned: a
 * link is a promise the seller keeps by hand — sending it, then confirming the
 * money arrived — so only the seller can make it.
 *
 * **A verb rather than the generic save**, for the reason `set-fiscal-identity`
 * is one: the record's name, slug and status are the operator's.
 *
 * ⚠️ **Only the caller's active organization.** Any other id answers
 * `NotFound`, the same answer as an organization that does not exist.
 */
@useCase({
  entity: Organization,
  key: 'set-payment-link-acceptance',
  binding: 'entity',
  placement: 'context-independent',
  labelKey: 'entity:organization.useCases.setPaymentLinkAcceptance',
  payload: PaymentLinkAcceptancePayload,
  errors: [NotFound],
})
export class SetPaymentLinkAcceptanceUC {
  static run(input: {
    readonly activeOrganizationId: string | undefined;
    readonly organizationId: string;
    readonly payload: PaymentLinkAcceptancePayload;
  }): Effect.Effect<
    { readonly accepts: boolean },
    NotFound | EntifixFailure,
    OrganizationPaymentLinkAcceptanceTag
  > {
    return Effect.gen(function* () {
      if (
        input.activeOrganizationId === undefined ||
        input.activeOrganizationId !== input.organizationId
      ) {
        return yield* Effect.fail(new NotFound({ entity: 'organization' }));
      }
      const accepts = input.payload.accepts === true;
      const writer = yield* OrganizationPaymentLinkAcceptanceTag;
      yield* writer.set(input.organizationId, accepts);
      return { accepts };
    });
  }
}

/**
 * The permission this use case derives. Import it; never retype the verb — the
 * source scan checks this against the grant table.
 */
export const SET_PAYMENT_LINK_ACCEPTANCE = permissionForUseCase(
  SetPaymentLinkAcceptanceUC,
);
