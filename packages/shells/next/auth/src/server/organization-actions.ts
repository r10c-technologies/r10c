'use server';

import { authorizationHeader, loadPrincipal } from './principal';
import { AUTH_SERVICE_URL } from './session';

/** What an organization form shows after a save. */
export interface OrganizationFormState {
  readonly status: 'idle' | 'saved' | 'refused';
  /** The `errors` catalog code the service answered with, when refused. */
  readonly code?: string;
  /** The member the refusal names, so the form can mark it. */
  readonly field?: string;
}

const FIELDS = [
  'taxId',
  'legalName',
  'taxRegime',
  'establishmentCode',
] as const;

/**
 * Post one of the caller's active organization's own verbs. A server action
 * rather than a browser fetch, so each form posts without script too;
 * auth-service checks the permission and that the organization is the
 * caller's own.
 */
const postVerb = async (
  verb: string,
  body: Readonly<Record<string, unknown>>,
): Promise<OrganizationFormState> => {
  const principal = await loadPrincipal();
  const organizationId = principal?.organizationId;
  if (organizationId === undefined || organizationId === null) {
    return { status: 'refused', code: 'notFound' };
  }
  const res = await fetch(
    `${AUTH_SERVICE_URL}/api/organization/${encodeURIComponent(organizationId)}/${verb}`,
    {
      method: 'POST',
      headers: {
        ...(await authorizationHeader()),
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      cache: 'no-store',
    },
  ).catch(() => undefined);
  if (res === undefined) return { status: 'refused', code: 'network' };
  if (res.ok) return { status: 'saved' };
  const problem = (await res.json().catch(() => ({}))) as {
    code?: unknown;
    field?: unknown;
  };
  return {
    status: 'refused',
    code: typeof problem.code === 'string' ? problem.code : 'unexpected',
    ...(typeof problem.field === 'string' ? { field: problem.field } : {}),
  };
};

/** Save the organization's fiscal identity (`set-fiscal-identity`, ADR 0078 §6). */
export async function saveFiscalIdentity(
  _previous: OrganizationFormState,
  formData: FormData,
): Promise<OrganizationFormState> {
  return postVerb(
    'set-fiscal-identity',
    Object.fromEntries(
      FIELDS.map(field => [field, String(formData.get(field) ?? '')]),
    ),
  );
}

/**
 * Save whether the organization takes payment links
 * (`set-payment-link-acceptance`, ADR 0081 §1). An unticked box posts nothing,
 * which is the "no".
 */
export async function savePaymentLinkAcceptance(
  _previous: OrganizationFormState,
  formData: FormData,
): Promise<OrganizationFormState> {
  return postVerb('set-payment-link-acceptance', {
    accepts: formData.get('accepts') === 'on',
  });
}
