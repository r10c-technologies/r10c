import { OrganizationView } from '../client/organization-view';
import { authorizationHeader, loadPrincipal } from './principal';
import { AUTH_SERVICE_URL } from './session';

/** The fiscal identity as the form starts from it. */
export interface FiscalIdentityValues {
  readonly taxId: string;
  readonly legalName: string;
  readonly taxRegime: string;
  readonly establishmentCode: string;
}

const readFiscalIdentity = async (
  organizationId: string,
): Promise<FiscalIdentityValues | null | undefined> => {
  const res = await fetch(
    `${AUTH_SERVICE_URL}/api/organization/${encodeURIComponent(organizationId)}/fiscal-identity`,
    { headers: await authorizationHeader(), cache: 'no-store' },
  ).catch(() => undefined);
  if (res === undefined || !res.ok) return undefined;
  const body = (await res.json()) as { fiscal?: FiscalIdentityValues | null };
  return body.fiscal ?? null;
};

/**
 * `/account/organization` — the active organization's fiscal identity: the
 * NIT, legal name, regime and establishment every order it sells is
 * documented under (ADR 0078 §6). The caller's own organization, like the
 * account pages around it; auth-service refuses anyone without
 * `set-fiscal-identity`, so a failed read renders as one rather than as an
 * empty form.
 */
export async function OrganizationPage() {
  const principal = await loadPrincipal();
  const organizationId = principal?.organizationId ?? undefined;
  const fiscal =
    organizationId === undefined
      ? undefined
      : await readFiscalIdentity(organizationId);
  return <OrganizationView fiscal={fiscal} />;
}
