import { permissionForUseCase } from '@entifix/authz';
import { type EntifixFailure, NotFound, useCase } from '@entifix/core';
import { Effect } from 'effect';

import { Organization } from '../../entities/organization';
import { InvalidFiscalIdentity } from '../../failures/organization-failures';
import { OrganizationFiscalIdentityTag } from '../../ports/organization-fiscal-identity';
import {
  type FiscalIdentity,
  fiscalIdentityOf,
  FiscalIdentityPayload,
} from '../../values/fiscal-identity';

/**
 * The organization states its own fiscal identity — the NIT, legal name,
 * regime and establishment every order it sells is documented under
 * (ADR 0078 §6).
 *
 * **A verb rather than the generic save**, because the record has two
 * authors: the operator provisions the name, slug and status, and the
 * organization's own `admin` states how it files. A `write` grant would hand
 * the second the first's members.
 *
 * ⚠️ **Only the caller's active organization.** The id in the route is checked
 * against the session's `activeOrganizationId`, and any other answers
 * `NotFound` — the same answer as an organization that does not exist, so the
 * verb is no oracle for which ids are real.
 */
@useCase({
  entity: Organization,
  key: 'set-fiscal-identity',
  binding: 'entity',
  placement: 'context-independent',
  labelKey: 'entity:organization.useCases.setFiscalIdentity',
  payload: FiscalIdentityPayload,
  errors: [NotFound, InvalidFiscalIdentity],
})
export class SetFiscalIdentityUC {
  static run(input: {
    readonly activeOrganizationId: string | undefined;
    readonly organizationId: string;
    readonly payload: FiscalIdentityPayload;
  }): Effect.Effect<
    FiscalIdentity,
    NotFound | InvalidFiscalIdentity | EntifixFailure,
    OrganizationFiscalIdentityTag
  > {
    return Effect.gen(function* () {
      if (
        input.activeOrganizationId === undefined ||
        input.activeOrganizationId !== input.organizationId
      ) {
        return yield* Effect.fail(new NotFound({ entity: 'organization' }));
      }
      const checked = fiscalIdentityOf(input.payload);
      if (!checked.ok) {
        return yield* Effect.fail(
          new InvalidFiscalIdentity({ field: checked.field }),
        );
      }
      const writer = yield* OrganizationFiscalIdentityTag;
      yield* writer.set(input.organizationId, checked.value);
      return checked.value;
    });
  }
}

/**
 * The permission this use case derives. Import it; never retype the verb — the
 * source scan checks this against the grant table.
 */
export const SET_FISCAL_IDENTITY = permissionForUseCase(SetFiscalIdentityUC);
