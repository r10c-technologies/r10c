import { NextResponse } from 'next/server';

const CONFIG_API_URL = process.env.CONFIG_API_URL ?? 'http://localhost:3190';
const SERVICE = 'marketplace-admin-app';

/**
 * Server-side route handler that fetches this app's centralized configuration
 * from config-service and returns it as ConfigurationPlain.
 */
export async function GET() {
  const res = await fetch(`${CONFIG_API_URL}/api/config/${SERVICE}`, {
    cache: 'no-store',
  });

  if (!res.ok) {
    return NextResponse.json(
      { error: 'Failed to load configuration' },
      { status: 502 }
    );
  }

  return NextResponse.json(await res.json());
}
