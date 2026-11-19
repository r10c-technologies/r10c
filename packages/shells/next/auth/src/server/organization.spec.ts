import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const principal = vi.hoisted(() => ({
  current: { organizationId: 'org-1' } as { organizationId?: string } | null,
}));

vi.mock('./principal', () => ({
  loadPrincipal: async () => principal.current,
  authorizationHeader: async () => ({ authorization: 'Bearer t' }),
}));
vi.mock('./session', () => ({ AUTH_SERVICE_URL: 'http://auth' }));

const { saveFiscalIdentity } = await import('./organization-actions');
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

describe('OrganizationPage', () => {
  const fiscalOf = async () =>
    ((await OrganizationPage()) as { props: { fiscal: unknown } }).props.fiscal;

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
