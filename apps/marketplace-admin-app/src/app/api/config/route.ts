import { NextResponse } from 'next/server';

const CONFIG_API_URL = process.env.CONFIG_API_URL ?? 'http://localhost:3190';
const SERVICE = 'marketplace-admin-app';

/** Where the browser adapters must send catalog traffic — see the proxy route. */
const SERVICE_DOMAIN_KEY = 'marketplace-admin-service-domain';
const SAME_ORIGIN_PROXY = '/api/admin';

/**
 * Server-side route handler that fetches this app's centralized configuration
 * from config-service and returns it as ConfigurationPlain.
 *
 * The service domain is rewritten to this app's own `/api/admin` proxy before
 * the browser sees it. config-service holds the real address, which is what the
 * *server* needs; a browser pointed at it would be making a cross-origin request
 * that carries no session cookie and gets a `401`. Rewriting here keeps the
 * address in one place and the adapters unaware.
 */
export async function GET() {
  const res = await fetch(`${CONFIG_API_URL}/api/config/${SERVICE}`, {
    cache: 'no-store',
  });

  if (!res.ok) {
    return NextResponse.json(
      { error: 'Failed to load configuration' },
      { status: 502 },
    );
  }

  const plain = (await res.json()) as Record<
    string,
    Array<{ key: string; value: unknown }>
  >;

  return NextResponse.json({
    ...plain,
    uri: (plain['uri'] ?? []).map(parameter =>
      parameter.key === SERVICE_DOMAIN_KEY
        ? { ...parameter, value: SAME_ORIGIN_PROXY }
        : parameter,
    ),
  });
}
