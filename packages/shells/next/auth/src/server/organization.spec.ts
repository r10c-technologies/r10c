import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const principal = vi.hoisted(() => ({
  current: { organizationId: 'org-1' } as { organizationId?: string } | null,
}));

vi.mock('./principal', () => ({
  loadPrincipal: async () => principal.current,
  authorizationHeader: async () => ({ authorization: 'Bearer t' }),
}));
vi.mock('./session', () => ({ AUTH_SERVICE_URL: 'http://auth' }));

const { saveFiscalIdentity, savePaymentLinkAcceptance, saveWhatsappNumber } =
  await import('./organization-actions');
const { OrganizationPage } = await import('./organization-page');

const FISCAL = {
  taxId: '10000003',
  legalName: 'Demo, S.A.',
  taxRegime: 'general',
  establishmentCode: '1',
};

const form = () => {
  const data = new FormData();
  for (const [key, value] of Object.entries(FISCAL)) data.set(key, value);
  return data;
};

const answer = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

let calls: Array<{ url: string; init?: RequestInit }> = [];
const stubFetch = (respond: () => Promise<Response>) =>
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    calls.push({ url, ...(init === undefined ? {} : { init }) });
    return respond();
  });

beforeEach(() => {
  calls = [];
  principal.current = { organizationId: 'org-1' };
});
afterEach(() => vi.unstubAllGlobals());

describe('saveFiscalIdentity', () => {
  const idle = { status: 'idle' } as const;

  it('posts the form to the active organization’s verb', async () => {
    stubFetch(() => answer(200, {}));
    expect(await saveFiscalIdentity(idle, form())).toEqual({ status: 'saved' });
    expect(calls[0]?.url).toBe(
      'http://auth/api/organization/org-1/set-fiscal-identity',
    );
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual(FISCAL);
  });

  it('answers the refusal’s code and field', async () => {
    stubFetch(() =>
      answer(400, { code: 'invalidFiscalIdentity', field: 'taxId' }),
    );
    expect(await saveFiscalIdentity(idle, new FormData())).toEqual({
      status: 'refused',
      code: 'invalidFiscalIdentity',
      field: 'taxId',
    });
  });

  it('says unexpected for a refusal with no problem body', async () => {
    stubFetch(() => Promise.resolve(new Response('no', { status: 500 })));
    expect(await saveFiscalIdentity(idle, form())).toEqual({
      status: 'refused',
      code: 'unexpected',
    });
  });

  it('says network when auth-service cannot be reached', async () => {
    stubFetch(() => Promise.reject(new Error('down')));
    expect(await saveFiscalIdentity(idle, form())).toEqual({
      status: 'refused',
      code: 'network',
    });
  });

  it('refuses a session in no organization without calling anyone', async () => {
    principal.current = {};
    stubFetch(() => answer(200, {}));
    expect(await saveFiscalIdentity(idle, form())).toEqual({
      status: 'refused',
      code: 'notFound',
    });
    principal.current = null;
    expect(await saveFiscalIdentity(idle, form())).toMatchObject({
      code: 'notFound',
    });
    expect(calls).toEqual([]);
  });
});

describe('savePaymentLinkAcceptance', () => {
  const idle = { status: 'idle' } as const;

  it('posts a ticked box as yes and an unticked one as no', async () => {
    stubFetch(() => answer(200, {}));
    const ticked = new FormData();
    ticked.set('accepts', 'on');
    expect(await savePaymentLinkAcceptance(idle, ticked)).toEqual({
      status: 'saved',
    });
    expect(await savePaymentLinkAcceptance(idle, new FormData())).toEqual({
      status: 'saved',
    });
    expect(calls[0]?.url).toBe(
      'http://auth/api/organization/org-1/set-payment-link-acceptance',
    );
    expect(calls.map(call => JSON.parse(String(call.init?.body)))).toEqual([
      { accepts: true },
      { accepts: false },
    ]);
  });
});

describe('saveWhatsappNumber', () => {
  const idle = { status: 'idle' } as const;

  it('posts the typed number, and nothing typed as none', async () => {
    stubFetch(() => answer(200, {}));
    const typed = new FormData();
    typed.set('number', '5555-1234');
    expect(await saveWhatsappNumber(idle, typed)).toEqual({ status: 'saved' });
    expect(await saveWhatsappNumber(idle, new FormData())).toEqual({
      status: 'saved',
    });
    expect(calls[0]?.url).toBe(
      'http://auth/api/organization/org-1/set-whatsapp-number',
    );
    expect(calls.map(call => JSON.parse(String(call.init?.body)))).toEqual([
      { number: '5555-1234' },
      { number: '' },
    ]);
  });
});

describe('OrganizationPage', () => {
  const propsOf = async () =>
    (
      (await OrganizationPage()) as {
        props: { fiscal: unknown; paymentLink: unknown; whatsapp: unknown };
      }
    ).props;
  const fiscalOf = async () => (await propsOf()).fiscal;

  it('reads whether the organization takes payment links, failing as undefined', async () => {
    stubFetch(() => answer(200, { id: 'org-1', accepts: true }));
    expect((await propsOf()).paymentLink).toBe(true);
    stubFetch(() => answer(200, { id: 'org-1' }));
    expect((await propsOf()).paymentLink).toBe(false);
    stubFetch(() => answer(403, {}));
    expect((await propsOf()).paymentLink).toBeUndefined();
    principal.current = null;
    expect((await propsOf()).paymentLink).toBeUndefined();
  });

  it('reads the organization’s WhatsApp number, failing as undefined', async () => {
    stubFetch(() => answer(200, { id: 'org-1', number: '+50255551234' }));
    expect((await propsOf()).whatsapp).toBe('+50255551234');
    stubFetch(() => answer(200, { id: 'org-1' }));
    expect((await propsOf()).whatsapp).toBe('');
    stubFetch(() => answer(403, {}));
    expect((await propsOf()).whatsapp).toBeUndefined();
    stubFetch(() => Promise.reject(new Error('down')));
    expect((await propsOf()).whatsapp).toBeUndefined();
  });

  it('starts the form from the stored identity, or empty when there is none', async () => {
    stubFetch(() => answer(200, { id: 'org-1', fiscal: FISCAL }));
    expect(await fiscalOf()).toEqual(FISCAL);
    stubFetch(() => answer(200, { id: 'org-1', fiscal: null }));
    expect(await fiscalOf()).toBeNull();
    stubFetch(() => answer(200, { id: 'org-1' }));
    expect(await fiscalOf()).toBeNull();
  });

  it('renders a failed read as one, never as an empty form', async () => {
    stubFetch(() => answer(403, {}));
    expect(await fiscalOf()).toBeUndefined();
    stubFetch(() => Promise.reject(new Error('down')));
    expect(await fiscalOf()).toBeUndefined();
    principal.current = null;
    expect(await fiscalOf()).toBeUndefined();
  });
});
