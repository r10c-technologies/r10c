import {
  defineEntityApi,
  type EntityApiContext,
  type EntityApiRequest,
  RequestPrincipalTag,
  verbEndpoint,
} from '@entifix/business';
import { defineEndpoint, entityKey, implement, NotFound } from '@entifix/core';
import {
  type FiscalIdentityPayload,
  Organization,
  OrganizationFiscalIdentityTag,
  SET_FISCAL_IDENTITY,
  SetFiscalIdentityUC,
} from '@r10c/business-ts-party-management';
import { Effect, Schema } from 'effect';

/**
 * `POST /api/organization/:id/set-fiscal-identity` — the organization's own
 * `admin` states the NIT, legal name, regime and establishment its orders are
 * documented under (ADR 0078 §6). The use case refuses any organization but
 * the session's active one; the write re-announces it, so the published
 * vendor projection every checkout copies from follows.
 */
const setFiscalIdentity = verbEndpoint(SetFiscalIdentityUC, {
  guard: { kind: 'permission' },
  handler: (request: EntityApiRequest, context: EntityApiContext) =>
    SetFiscalIdentityUC.run({
      activeOrganizationId: context.principal?.organizationId,
      organizationId: String(request.params?.id),
      payload: request.payload as FiscalIdentityPayload,
    }),
});

/**
 * An organization's endpoints are its verb alone: nothing lists or saves an
 * `Organization` through this group — the operator provisions it — and
 * serving the group is what serves the `$metadata` the form reads the verb
 * from.
 */
export const organizationApi = defineEntityApi(
  Organization,
  entityKey(Organization, 'organization'),
  { verbs: [], guard: { kind: 'permission' }, useCases: [setFiscalIdentity] },
);

const FiscalIdentityBody = Schema.Struct({
  taxId: Schema.String,
  legalName: Schema.String,
  taxRegime: Schema.String,
  establishmentCode: Schema.String,
});

/**
 * `GET /api/organization/:id/fiscal-identity` — what the form shows before the
 * organization edits it. Guarded by the verb's own permission, because the
 * only reader is the person who may change it, and answered `NotFound` for
 * any organization but the caller's active one, as the verb is.
 */
const readFiscalIdentity = defineEndpoint({
  name: 'organization-fiscal-identity',
  method: 'GET',
  path: '/api/organization/:id/fiscal-identity',
  params: { id: Schema.String },
  success: Schema.Struct({
    id: Schema.String,
    fiscal: Schema.NullOr(FiscalIdentityBody),
  }),
  errors: [NotFound],
  guard: { kind: 'permission', permission: SET_FISCAL_IDENTITY },
});

export const organizationEndpoints = [
  implement(readFiscalIdentity, ({ params }) =>
    Effect.gen(function* () {
      const principal = yield* RequestPrincipalTag;
      if (principal.organizationId !== params.id) {
        return yield* Effect.fail(new NotFound({ entity: 'organization' }));
      }
      const identities = yield* OrganizationFiscalIdentityTag;
      const fiscal = yield* identities.get(params.id);
      return { id: params.id, fiscal: fiscal ?? null };
    }),
  ),
] as const;
