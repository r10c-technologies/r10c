import { NextResponse } from 'next/server';

import { SERVICE_TOKEN_HEADER, serviceToken } from './service-token';

/** A group of parameters as `ConfigurationPlain` carries them. */
type PlainConfiguration = Record<string, Array<{ key: string; value: unknown }>>;

/**
 * Rewrites backend addresses to the app's own same-origin proxy paths.
 *
 * config-service holds the real address, which is what the *server* needs. A
 * browser pointed at it would be making a cross-origin request that carries no
 * session cookie and gets a `401` — `r10c_at` is httpOnly and same-origin, and
 * host-scoping it does not help, since that governs which host stores the cookie
 * rather than which cross-origin requests send it.
 *
 * So each service domain is swapped for a path on this app's own origin before
 * the browser ever sees it, which leaves the entity adapters unaware that a proxy
 * exists at all. `map` is keyed by the configuration key, e.g.
 * `{ 'config-service-domain': '/api/system' }`.
 *
 * Keys absent from `map` are passed through untouched, so an app only names the
 * domains it actually proxies.
 */
export const rewriteServiceDomains = (
  plain: PlainConfiguration,
  map: Readonly<Record<string, string>>,
): PlainConfiguration => ({
  ...plain,
  uri: (plain['uri'] ?? []).map(parameter =>
    parameter.key in map
      ? { ...parameter, value: map[parameter.key] }
      : parameter,
  ),
});

export interface ConfigRouteOptions {
  /** This app's key in the `configuration` table, e.g. `marketplace-admin-app`. */
  readonly service: string;
  /** Service domains to rewrite to same-origin proxy paths. */
  readonly proxies?: Readonly<Record<string, string>>;
  /** Overrides `CONFIG_API_URL`; mainly for tests. */
  readonly configApiUrl?: string;
}

/**
 * Builds the `GET /api/config` route handler every Next app exposes: fetch this
 * app's configuration from config-service, rewrite the proxied domains, and hand
 * the result to the browser.
 *
 * Shared because all three apps did the same thing, and because the shared-token
 * header is the kind of detail that goes stale in one copy out of three.
 */
export const createConfigRoute = ({
  service,
  proxies = {},
  configApiUrl,
}: ConfigRouteOptions) =>
  async function GET(): Promise<Response> {
    const baseUrl =
      configApiUrl ?? process.env.CONFIG_API_URL ?? 'http://localhost:3190';

    const response = await fetch(`${baseUrl}/api/config/${service}`, {
      cache: 'no-store',
      headers: { [SERVICE_TOKEN_HEADER]: serviceToken() },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Failed to load configuration' },
        { status: 502 },
      );
    }

    const plain = (await response.json()) as PlainConfiguration;

    return NextResponse.json(rewriteServiceDomains(plain, proxies));
  };
