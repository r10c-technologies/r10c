import { cookies } from 'next/headers';

import { AT_COOKIE } from './cookies';

/**
 * The caller's access token, or `undefined` when they hold no session.
 *
 * `r10c_at` is httpOnly, so only the server can read it — which is the whole
 * reason a browser talks to a backend through this app's own origin rather than
 * calling `:310N` directly.
 */
export const sessionToken = async (): Promise<string | undefined> =>
  (await cookies()).get(AT_COOKIE)?.value;

/**
 * The token as a forwardable header, and `{}` when there is none.
 *
 * The empty case is the point: a header of `Bearer undefined` is not "no
 * credential", it is a malformed one, and a service that answers `401` to both
 * hides the difference right up until one of them starts answering something
 * else. Omitting the header lets the upstream apply its own rule for an
 * anonymous caller — which for `catalog-reference` reads is to allow it.
 *
 * This lives on its own because three server surfaces carry the same cookie the
 * same way — the per-backend proxy, the auth shell's hand-written handlers, and
 * the record search fan-out — and none of them grants anything by doing so. They
 * only carry; the service still verifies the token and applies its own
 * `requirePermission`.
 */
export const bearerHeader = (
  token: string | undefined,
): Record<string, string> =>
  token === undefined ? {} : { Authorization: `Bearer ${token}` };
