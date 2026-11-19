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
  OrganizationPaymentLinkAcceptanceTag,
  type PaymentLinkAcceptancePayload,
  SET_FISCAL_IDENTITY,
  SET_PAYMENT_LINK_ACCEPTANCE,
  SetFiscalIdentityUC,
  SetPaymentLinkAcceptanceUC,
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
 * `POST /api/organization/:id/set-payment-link-acceptance` — the organization's
 * own `admin` says whether it takes payment by a link it sends the buyer
 * (ADR 0081 §1). The write re-announces it, so the checkout's `acceptsLink`
 * follows.
 */
const setPaymentLinkAcceptance = verbEndpoint(SetPaymentLinkAcceptanceUC, {
  guard: { kind: 'permission' },
  handler: (request: EntityApiRequest, context: EntityApiContext) =>
    SetPaymentLinkAcceptanceUC.run({
      activeOrganizationId: context.principal?.organizationId,
      organizationId: String(request.params?.id),
      payload: request.payload as PaymentLinkAcceptancePayload,
    }),
});

/**
 * An organization's endpoints are its verbs alone: nothing lists or saves an
 * `Organization` through this group — the operator provisions it — and
 * serving the group is what serves the `$metadata` the form reads the verb
 * from.
 */
export const organizationApi = defineEntityApi(
  Organization,
  entityKey(Organization, 'organization'),
  {
    verbs: [],
    guard: { kind: 'permission' },
    useCases: [setFiscalIdentity, setPaymentLinkAcceptance],
  },
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

/**
 * `GET /api/organization/:id/payment-link-acceptance` — what the toggle shows
 * before the organization changes it, guarded and scoped as its verb is.
 */
const readPaymentLinkAcceptance = defineEndpoint({
  name: 'organization-payment-link-acceptance',
  method: 'GET',
  path: '/api/organization/:id/payment-link-acceptance',
  params: { id: Schema.String },
  success: Schema.Struct({ id: Schema.String, accepts: Schema.Boolean }),
  errors: [NotFound],
  guard: { kind: 'permission', permission: SET_PAYMENT_LINK_ACCEPTANCE },
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
  implement(readPaymentLinkAcceptance, ({ params }) =>
    Effect.gen(function* () {
      const principal = yield* RequestPrincipalTag;
      if (principal.organizationId !== params.id) {
        return yield* Effect.fail(new NotFound({ entity: 'organization' }));
      }
      const acceptance = yield* OrganizationPaymentLinkAcceptanceTag;
      return { id: params.id, accepts: yield* acceptance.get(params.id) };
    }),
  ),
] as const;
