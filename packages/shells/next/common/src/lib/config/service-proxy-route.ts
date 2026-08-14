import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { AT_COOKIE } from '../session/cookies';

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
 * A factory, because a host mounts one of these per backend it talks to, and
 * back-office-app now talks to two: marketplace-admin-service for the catalog a
 * vendor authors, marketplace-service for the platform vocabulary it is
 * classified in (ADR 0022).
 */
export const createServiceProxyRoute = ({
  baseUrl,
}: ServiceProxyRouteOptions) => {
  const forward = async (
    request: Request,
    { params }: Params,
  ): Promise<Response> => {
    const { path } = await params;
    const token = (await cookies()).get(AT_COOKIE)?.value;
    const search = new URL(request.url).search;

    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (token !== undefined) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const hasBody = request.method !== 'GET' && request.method !== 'DELETE';
    const upstream = await fetch(`${baseUrl}/api/${path.join('/')}${search}`, {
      method: request.method,
      headers,
      body: hasBody ? await request.text() : undefined,
      cache: 'no-store',
    });

    // 204s and empty bodies must not be run through `json()`.
    const text = await upstream.text();
    return text === ''
      ? new NextResponse(null, { status: upstream.status })
      : new NextResponse(text, {
          status: upstream.status,
          headers: { 'content-type': 'application/json' },
        });
  };

  return forward;
};
