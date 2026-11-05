/**
 * The one auth-service route the back office's **server** calls in the `mock`
 * profile: `GET /api/me`, which the `(account)` and `(back-office)` layouts
 * use to resolve the principal before rendering (`loadPrincipal`).
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
  return { userId, subject, sessionId, roles, attributes };
};

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
  response
    .writeHead(404, { 'content-type': 'application/problem+json' })
    .end(
      JSON.stringify({ type: 'about:blank', code: 'notFound', status: 404 }),
    );
});

server.listen(FAKE_AUTH_PORT);
