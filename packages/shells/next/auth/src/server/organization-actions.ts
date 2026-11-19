'use server';

import { authorizationHeader, loadPrincipal } from './principal';
import { AUTH_SERVICE_URL } from './session';

/** What the organization form shows after a save. */
export interface FiscalIdentityFormState {
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
 * Save the caller's active organization's fiscal identity
 * (`set-fiscal-identity`, ADR 0078 §6). A server action rather than a
 * browser fetch, so the form posts without script too; auth-service checks
 * the permission and that the organization is the caller's own.
 */
export async function saveFiscalIdentity(
  _previous: FiscalIdentityFormState,
  formData: FormData,
): Promise<FiscalIdentityFormState> {
  const principal = await loadPrincipal();
  const organizationId = principal?.organizationId;
  if (organizationId === undefined || organizationId === null) {
    return { status: 'refused', code: 'notFound' };
  }
  const body = Object.fromEntries(
    FIELDS.map(field => [field, String(formData.get(field) ?? '')]),
  );
  const res = await fetch(
    `${AUTH_SERVICE_URL}/api/organization/${encodeURIComponent(organizationId)}/set-fiscal-identity`,
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
}
