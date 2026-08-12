import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const ADMIN_SERVICE_URL =
  process.env.MARKETPLACE_ADMIN_SERVICE_URL ?? 'http://localhost:3101';
const AT_COOKIE = 'r10c_at';

type Params = { params: Promise<{ path: string[] }> };

/**
 * Same-origin proxy for marketplace-admin-service.
 *
 * The catalog adapters used to call `:3101` straight from the browser, which
 * worked only while those routes were public: a different port is a different
 * origin, so the `r10c_at` cookie is not attached to the request and a guarded
 * service answers `401`. Host-scoping the cookie does not help — that governs
 * which host stores it, not which cross-origin requests carry it.
 *
 * Routing through the app's own origin makes the cookie automatic and needs no
 * CORS, which is the same reason the credential routes are shaped this way. The
 * cookie is forwarded upstream as a bearer token; the service still verifies it
 * and applies `requirePermission`, so this proxy grants nothing — it only
 * carries.
 */
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
  const upstream = await fetch(
    `${ADMIN_SERVICE_URL}/api/${path.join('/')}${search}`,
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

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
