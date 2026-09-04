import { NextResponse } from 'next/server';

import { bearerHeader, sessionToken } from '../session/bearer';

type Params = { params: Promise<{ path: string[] }> };

export interface ServiceProxyRouteOptions {
  /** Where the service listens, without the `/api` suffix. */
  readonly baseUrl: string;
}

/**
 * Builds a same-origin proxy for one backend service, mounted as a catch-all
 * route handler — e.g. `app/api/admin/[...path]/route.ts`.
 *
 * The browser can never call `:310N` directly: `r10c_at` is httpOnly and
 * same-origin, so a cross-origin request carries no cookie and a guarded route
 * answers `401`. Host-scoping the cookie does not help — that governs which host
 * *stores* it, not which cross-origin requests send it. Routing through the app's
 * own origin makes the cookie automatic and needs no CORS, which is the same
 * reason the credential routes are shaped this way.
 *
 * The cookie is forwarded upstream as a bearer token. **This proxy grants
 * nothing** — the service still verifies the token and applies its own
 * `requirePermission`. It only carries.
 *
 * It also carries the **caching contract** in both directions, which it did not
 * always: rebuilding every response as a fresh body dropped `ETag`,
 * `Cache-Control` and `Vary`, and forwarded no `If-None-Match`. The effect was
 * invisible and entirely wasteful — `GET /api/<entity>/$metadata` computes and
 * hashes a permission-filtered document per request, and a validator that never
 * reaches the service means it can never answer `304`. Worse, `Vary` is a
 * *correctness* header here: the document differs per caller, and one stripped
 * of `Vary: Cookie, Authorization` may be cached and served to a different
 * principal.
 *
 * A factory, because a host mounts one of these per backend it talks to, and
 * back-office-app now talks to two: marketplace-admin-service for the catalog a
 * vendor authors, marketplace-service for the platform vocabulary it is
 * classified in (ADR 0022).
 */
/**
 * Response headers that must survive the rebuild.
 *
 * Deliberately a short allow-list rather than copying every header: the
 * upstream's `content-length` and `content-encoding` describe *its* body, and
 * carrying them onto a response this function reconstructs is how a proxy
 * serves a truncated payload.
 */
const CACHE_HEADERS = ['etag', 'cache-control', 'vary'] as const;

/**
 * Whether the upstream answer must be piped rather than rebuilt.
 *
 * Reading a `text/event-stream` body to completion holds the request open
 * forever and delivers nothing — no error, no timeout, and the browser's
 * `EventSource` sits in `CONNECTING` while the service is happily emitting.
 * It is the most likely way to build the reactive stream, see silence, and go
 * looking in the wrong service (ADR 0036).
 */
const isStreamed = (upstream: Response): boolean =>
  upstream.headers.get('content-type')?.startsWith('text/event-stream') ===
  true;

const passThrough = (upstream: Response): Record<string, string> => {
  const headers: Record<string, string> = {};
  for (const name of CACHE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) headers[name] = value;
  }
  return headers;
};

export const createServiceProxyRoute = ({
  baseUrl,
}: ServiceProxyRouteOptions) => {
  const forward = async (
    request: Request,
    { params }: Params,
  ): Promise<Response> => {
    const { path } = await params;
    const search = new URL(request.url).search;

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      ...bearerHeader(await sessionToken()),
    };

    // Forwarded, or the validator never reaches the service and every
    // `$metadata` read is a full document — see {@link CACHE_HEADERS}.
    const ifNoneMatch = request.headers.get('if-none-match');
    if (ifNoneMatch !== null) {
      headers['if-none-match'] = ifNoneMatch;
    }

    const hasBody = request.method !== 'GET' && request.method !== 'DELETE';
    const upstream = await fetch(`${baseUrl}/api/${path.join('/')}${search}`, {
      method: request.method,
      headers,
      body: hasBody ? await request.text() : undefined,
      cache: 'no-store',
    });

    const passed = passThrough(upstream);

    // A `304` carries no body by definition, and neither does a `204`. Running
    // either through a body read is not merely wasteful — a `304` reconstructed
    // with a body is no longer a `304`.
    if (upstream.status === 304) {
      return new NextResponse(null, { status: 304, headers: passed });
    }

    // Piped, never buffered, and never re-typed as JSON: the body is an open
    // stream of frames, and `no-store` is correctness rather than politeness —
    // this response is scoped to one principal.
    if (isStreamed(upstream)) {
      return new NextResponse(upstream.body, {
        status: upstream.status,
        headers: {
          ...passed,
          'content-type': 'text/event-stream',
          'cache-control': 'no-store',
        },
      });
    }

    // 204s and empty bodies must not be run through `json()`.
    const text = await upstream.text();
    return text === ''
      ? new NextResponse(null, { status: upstream.status, headers: passed })
      : new NextResponse(text, {
          status: upstream.status,
          headers: { ...passed, 'content-type': 'application/json' },
        });
  };

  return forward;
};
