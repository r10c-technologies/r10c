import { permissionForUseCase } from '@entifix/authz';
import { type EntifixFailure, Invalid, NotFound, useCase } from '@entifix/core';
import { normalizePhone } from '@r10c/business-ts-order-contracts';
import { Effect, Schema } from 'effect';

import { Organization } from '../../entities/organization';
import { OrganizationWhatsappNumberTag } from '../../ports/organization-whatsapp-number';

/** What `set-whatsapp-number` accepts: a Guatemalan number, or `''` for none. */
export const WhatsappNumberPayload = Schema.Struct({
  number: Schema.String,
});

export type WhatsappNumberPayload = typeof WhatsappNumberPayload.Type;

/**
 * The organization states the WhatsApp number its buyers may write to (#671).
 * Public — the storefront links to it from every receipt with this seller on
 * it — so it is authored by the organization itself and never provisioned.
 * Stored as E.164 (`+50255551234`), checked as the buyer's own phone is;
 * an empty number withdraws it.
 *
 * **A verb rather than the generic save**, for the reason `set-fiscal-identity`
 * is one: the record's name, slug and status are the operator's.
 *
 * ⚠️ **Only the caller's active organization.** Any other id answers
 * `NotFound`, the same answer as an organization that does not exist.
 */
@useCase({
  entity: Organization,
  key: 'set-whatsapp-number',
  binding: 'entity',
  placement: 'context-independent',
  labelKey: 'entity:organization.useCases.setWhatsappNumber',
  payload: WhatsappNumberPayload,
  errors: [NotFound, Invalid],
})
export class SetWhatsappNumberUC {
  static run(input: {
    readonly activeOrganizationId: string | undefined;
    readonly organizationId: string;
    readonly payload: WhatsappNumberPayload;
  }): Effect.Effect<
    { readonly number: string },
    NotFound | Invalid | EntifixFailure,
    OrganizationWhatsappNumberTag
  > {
    return Effect.gen(function* () {
      if (
        input.activeOrganizationId === undefined ||
        input.activeOrganizationId !== input.organizationId
      ) {
        return yield* Effect.fail(new NotFound({ entity: 'organization' }));
      }
      const typed = input.payload.number.trim();
      const number = typed === '' ? '' : normalizePhone(typed);
      if (number === undefined) {
        return yield* Effect.fail(
          new Invalid({
            errors: [
              {
                pointer: '/number',
                detail:
                  'a WhatsApp number is a Guatemalan number of eight digits',
                code: 'phoneNotGuatemalan',
              },
            ],
          }),
        );
      }
      const writer = yield* OrganizationWhatsappNumberTag;
      yield* writer.set(input.organizationId, number);
      return { number };
    });
  }
}

/**
 * The permission this use case derives. Import it; never retype the verb — the
 * source scan checks this against the grant table.
 */
export const SET_WHATSAPP_NUMBER = permissionForUseCase(SetWhatsappNumberUC);
