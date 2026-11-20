/**
 * The auth-service routes the back office's **server** calls in the `mock`
 * profile: `GET /api/me`, which the `(account)` and `(back-office)` layouts
 * use to resolve the principal before rendering (`loadPrincipal`), and the
 * organization's fiscal identity — read by `/account/organization` and set by
 * its server action, kept in memory for the run.
 *
 * Every other request a mock journey makes leaves the browser, where
 * `@msw/playwright` answers it. This one never does — the layout runs inside
 * the Next process — so without a server here the account, sessions and user
 * screens could only ever be asserted as a redirect, and the accessibility
 * gate (ADR 0075) could not render them.
 *
 * It accepts exactly the token `seedSession` fabricates: anything else is
 * `401`, so a layout still fails closed on a token it cannot verify. Run on its
 * own port, never auth-service's `3102`, so a dev fleet's real service is never
 * mistaken for it by `reuseExistingServer`.
 *
 *   node src/support/fake-auth-service.mjs   # listens on FAKE_AUTH_PORT (39102)
 */
import { createServer } from 'node:http';

export const FAKE_AUTH_PORT = Number(process.env.FAKE_AUTH_PORT ?? 39102);

/** The signature `seedSession` writes; a fabricated token carries nothing else. */
const E2E_SIGNATURE = 'e2e-not-a-real-signature';

const decode = segment =>
  JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));

/** The principal a fabricated bearer token stands for, or `null`. */
export const principalOf = authorization => {
  const token = /^Bearer (.+)$/.exec(authorization ?? '')?.[1];
  const [, payload, signature] = token?.split('.') ?? [];
  if (payload === undefined || signature !== E2E_SIGNATURE) return null;
  const claims = decode(payload);
  if (typeof claims.exp === 'number' && claims.exp * 1000 < Date.now()) {
    return null;
  }
  const { userId, subject, sessionId, roles, ...rest } = claims;
  // `exp` is the token's own bookkeeping, not one of the principal's attributes.
  const attributes = Object.fromEntries(
    Object.entries(rest).filter(([claim]) => claim !== 'exp'),
  );
  return {
    userId,
    subject,
    sessionId,
    roles,
    // What the real verifier maps the token's active organization to.
    organizationId: claims.activeOrganizationId ?? null,
    attributes,
  };
};

/** Each organization's fiscal identity, as the last save left it. */
const fiscalIdentities = new Map([
  [
    'e2e-organization',
    {
      taxId: '10000003',
      legalName: 'Tienda Demo, S.A.',
      taxRegime: 'general',
      establishmentCode: '1',
    },
  ],
]);

/** Each organization's payment-link acceptance, as the last save left it. */
const paymentLinkAcceptance = new Map([['e2e-organization', false]]);
const whatsappNumbers = new Map([['e2e-organization', '']]);

const json = (response, status, body) =>
  response
    .writeHead(status, {
      'content-type':
        status >= 400 ? 'application/problem+json' : 'application/json',
    })
    .end(JSON.stringify(body));

const readBody = request =>
  new Promise(resolve => {
    let raw = '';
    request.on('data', chunk => (raw += chunk));
    request.on('end', () => resolve(raw === '' ? {} : JSON.parse(raw)));
  });

const FISCAL_PATH =
  /^\/api\/organization\/([^/]+)\/(fiscal-identity|set-fiscal-identity|payment-link-acceptance|set-payment-link-acceptance|whatsapp-number|set-whatsapp-number)$/;

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (url.pathname === '/api/health/live') {
    response.writeHead(200).end('ok');
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/me') {
    const principal = principalOf(request.headers.authorization);
    if (principal === null) {
      response
        .writeHead(401, { 'content-type': 'application/problem+json' })
        .end(
          JSON.stringify({
            type: 'about:blank',
            code: 'unauthorized',
            status: 401,
          }),
        );
      return;
    }
    response
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify(principal));
    return;
  }
  const fiscal = FISCAL_PATH.exec(url.pathname);
  if (fiscal !== null) {
    const principal = principalOf(request.headers.authorization);
    const [, organizationId, route] = fiscal;
    // Only the organization the session acts for, as auth-service answers.
    if (principal === null || principal.organizationId !== organizationId) {
      json(response, 404, {
        type: 'about:blank',
        code: 'notFound',
        status: 404,
      });
      return;
    }
    if (request.method === 'GET' && route === 'fiscal-identity') {
      json(response, 200, {
        id: organizationId,
        fiscal: fiscalIdentities.get(organizationId) ?? null,
      });
      return;
    }
    if (request.method === 'POST' && route === 'set-fiscal-identity') {
      void readBody(request).then(body => {
        fiscalIdentities.set(organizationId, body);
        json(response, 200, { data: { id: organizationId, ...body } });
      });
      return;
    }
    if (request.method === 'GET' && route === 'payment-link-acceptance') {
      json(response, 200, {
        id: organizationId,
        accepts: paymentLinkAcceptance.get(organizationId) === true,
      });
      return;
    }
    if (request.method === 'GET' && route === 'whatsapp-number') {
      json(response, 200, {
        id: organizationId,
        number: whatsappNumbers.get(organizationId) ?? '',
      });
      return;
    }
    if (request.method === 'POST' && route === 'set-whatsapp-number') {
      void readBody(request).then(body => {
        // As auth-service stores it: E.164, from eight Guatemalan digits.
        const digits = String(body.number ?? '')
          .replace(/\D/g, '')
          .slice(-8);
        const number = digits.length === 8 ? `+502${digits}` : '';
        whatsappNumbers.set(organizationId, number);
        json(response, 200, { data: { number } });
      });
      return;
    }
    if (request.method === 'POST' && route === 'set-payment-link-acceptance') {
      void readBody(request).then(body => {
        paymentLinkAcceptance.set(organizationId, body.accepts === true);
        json(response, 200, { data: { accepts: body.accepts === true } });
      });
      return;
    }
  }
  json(response, 404, { type: 'about:blank', code: 'notFound', status: 404 });
});

server.listen(FAKE_AUTH_PORT);
