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

/** Whether the organization takes payment links; `undefined` for a failed read. */
const readPaymentLinkAcceptance = async (
  organizationId: string,
): Promise<boolean | undefined> => {
  const res = await fetch(
    `${AUTH_SERVICE_URL}/api/organization/${encodeURIComponent(organizationId)}/payment-link-acceptance`,
    { headers: await authorizationHeader(), cache: 'no-store' },
  ).catch(() => undefined);
  if (res === undefined || !res.ok) return undefined;
  const body = (await res.json()) as { accepts?: unknown };
  return body.accepts === true;
};

/** The organization's WhatsApp number; `undefined` for a failed read. */
const readWhatsappNumber = async (
  organizationId: string,
): Promise<string | undefined> => {
  const res = await fetch(
    `${AUTH_SERVICE_URL}/api/organization/${encodeURIComponent(organizationId)}/whatsapp-number`,
    { headers: await authorizationHeader(), cache: 'no-store' },
  ).catch(() => undefined);
  if (res === undefined || !res.ok) return undefined;
  const body = (await res.json()) as { number?: unknown };
  return typeof body.number === 'string' ? body.number : '';
};

/**
 * `/account/organization` — what the active organization states about
 * itself: its fiscal identity, the NIT, legal name, regime and establishment
 * every order it sells is documented under (ADR 0078 §6), and whether it takes
 * payment by a link it sends the buyer (ADR 0081 §1), and the WhatsApp number
 * its buyers may write to (#671). The caller's own organization, like the
 * account pages around it; auth-service refuses anyone without
 * `set-fiscal-identity`, so a failed read renders as one rather than as an
 * empty form.
 */
export async function OrganizationPage() {
  const principal = await loadPrincipal();
  const organizationId = principal?.organizationId ?? undefined;
  const [fiscal, paymentLink, whatsapp] =
    organizationId === undefined
      ? [undefined, undefined, undefined]
      : await Promise.all([
          readFiscalIdentity(organizationId),
          readPaymentLinkAcceptance(organizationId),
          readWhatsappNumber(organizationId),
        ]);
  return (
    <OrganizationView
      fiscal={fiscal}
      paymentLink={paymentLink}
      whatsapp={whatsapp}
    />
  );
}
