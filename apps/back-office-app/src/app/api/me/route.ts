import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const AT_COOKIE = 'r10c_at';
const ADMIN_SERVICE_URL =
  process.env.MARKETPLACE_ADMIN_SERVICE_URL ?? 'http://localhost:3101';

/**
 * Server-side proxy to the token-verified backend route. Reads the httpOnly
 * access cookie (invisible to browser JS) and forwards it as a bearer token to
 * marketplace-admin-service `/api/me`, which verifies the signature and returns
 * the principal. This is the "tokens in backend integration" proof, done
 * same-origin so no CORS is involved.
 */
export async function GET() {
  const token = (await cookies()).get(AT_COOKIE)?.value;
  if (token === undefined) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const res = await fetch(`${ADMIN_SERVICE_URL}/api/me`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
