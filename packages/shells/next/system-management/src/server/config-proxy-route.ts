import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const AT_COOKIE = 'r10c_at';

export interface ConfigProxyRouteOptions {
  /** Overrides `CONFIG_API_URL`; mainly for tests. */
  readonly configApiUrl?: string;
}

type Params = { params: Promise<{ path: string[] }> };

/**
 * Builds the same-origin proxy for config-service, to be mounted as a catch-all
 * route handler — e.g. `app/api/system/[...path]/route.ts`.
 *
 * The browser can never call `:3190` directly: `r10c_at` is httpOnly and
 * same-origin, so a cross-origin request carries no cookie and a guarded service
 * answers `401`. Host-scoping the cookie does not help — that governs which host
 * *stores* it, not which cross-origin requests send it. Routing through the app's
 * own origin makes the cookie automatic and needs no CORS.
 *
 * The cookie is forwarded upstream as a bearer token. **This proxy grants
 * nothing** — config-service still verifies the token and applies
 * `requirePermission('config:configuration:…')`. It only carries.
 *
 * Mount it at a path other than `/api/config`: that one is already the *fetch*
 * route every app exposes to hand its own configuration to the browser.
 *
 * A factory rather than a shared handler because each host mounts it on its own
 * origin; the second host is three lines, not a copy.
 */
export const createConfigProxyRoute = ({
  configApiUrl,
}: ConfigProxyRouteOptions = {}) => {
  const forward = async (
    request: Request,
    { params }: Params,
  ): Promise<Response> => {
    const baseUrl =
      configApiUrl ?? process.env.CONFIG_API_URL ?? 'http://localhost:3190';
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
    const upstream = await fetch(
      `${baseUrl}/api/${path.join('/')}${search}`,
      {
        method: request.method,
        headers,
        body: hasBody ? await request.text() : undefined,
        cache: 'no-store',
      },
    );

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
