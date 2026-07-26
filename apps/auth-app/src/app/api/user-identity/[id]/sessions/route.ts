import { NextResponse } from 'next/server';

import { authorizationHeader } from '../../../../../lib/principal';
import { AUTH_SERVICE_URL } from '../../../../../lib/session';

/**
 * Administrative session control, proxied same-origin.
 *
 * The permission check lives on auth-service (`authn:user-device:read|write`).
 * This handler only forwards the caller's verified token — it decides nothing,
 * and a caller without the grant gets a 403 from the service, not from here.
 */
const upstream = (id: string) =>
  `${AUTH_SERVICE_URL}/api/user-identity/${encodeURIComponent(id)}/sessions`;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const res = await fetch(upstream(id), {
    headers: await authorizationHeader(),
    cache: 'no-store',
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const res = await fetch(upstream(id), {
    method: 'DELETE',
    headers: await authorizationHeader(),
    cache: 'no-store',
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
