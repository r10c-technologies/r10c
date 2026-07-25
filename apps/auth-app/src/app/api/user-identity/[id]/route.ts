import { NextResponse } from 'next/server';

import { authorizationHeader } from '../../../../lib/principal';
import { AUTH_SERVICE_URL } from '../../../../lib/session';

type Params = { params: Promise<{ id: string }> };

/** Read one user, forwarding the access cookie as a bearer token. */
export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const res = await fetch(`${AUTH_SERVICE_URL}/api/user-identity/${id}`, {
    headers: await authorizationHeader(),
    cache: 'no-store',
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

/**
 * Change a user's role or status. auth-service revokes that user's sessions on
 * success, so the change takes effect immediately rather than when their
 * current access token expires.
 */
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const res = await fetch(`${AUTH_SERVICE_URL}/api/user-identity/${id}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      ...(await authorizationHeader()),
    },
    body: JSON.stringify(await request.json()),
    cache: 'no-store',
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
