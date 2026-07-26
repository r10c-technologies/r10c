import type { DeviceContext } from '@r10c/entifix-ts-business';
import { type NextRequest, type NextResponse, userAgent } from 'next/server';

/** Long-lived, opaque device id. Cleared with cookies — that is intended. */
export const DID_COOKIE = 'r10c_did';

/** Two years: long enough that a familiar browser stays familiar. */
const DID_MAX_AGE = 60 * 60 * 24 * 730;

/**
 * Mint an unguessable device id.
 *
 * `crypto.getRandomValues` rather than `node:crypto`, so this module also runs
 * on the edge runtime.
 */
const mintDeviceId = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
};

/**
 * Reduce a client IP to its /24 (or the v6 prefix).
 *
 * Enough to notice "this sign-in came from somewhere else", without keeping a
 * precise location against every session.
 */
export const truncateIp = (ip: string | undefined): string | undefined => {
  if (ip === undefined || ip === '') return undefined;
  if (ip.includes(':')) {
    return `${ip.split(':').slice(0, 4).join(':')}::`;
  }
  const octets = ip.split('.');
  return octets.length === 4 ? `${octets.slice(0, 3).join('.')}.0` : undefined;
};

/**
 * The client IP as the proxy reports it.
 *
 * `x-forwarded-for` is client-controlled unless a trusted proxy overwrites it,
 * which is why the value is only ever a label — see {@link DeviceContext}.
 */
const clientIp = (request: NextRequest): string | undefined => {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded !== null) return forwarded.split(',')[0]?.trim();
  return request.headers.get('x-real-ip') ?? undefined;
};

/**
 * Read (or mint) the device context for a request.
 *
 * Parsing uses `userAgent()` from `next/server` — already bundled with Next, so
 * no dependency is added, and notably not `ua-parser-js`, whose v2 is
 * AGPL/dual-licensed.
 *
 * Returns `issued` when the id had to be minted, so the caller knows to write
 * the cookie onto its response.
 */
export const readDeviceContext = (
  request: NextRequest,
): { device: DeviceContext; issued: boolean } => {
  const existing = request.cookies.get(DID_COOKIE)?.value;
  const deviceId = existing ?? mintDeviceId();
  const agent = userAgent(request);

  return {
    device: {
      deviceId,
      browser: agent.browser.name,
      os: agent.os.name,
      type: agent.device.type ?? 'desktop',
      ip: truncateIp(clientIp(request)),
    },
    issued: existing === undefined,
  };
};

/**
 * Persist the device id.
 *
 * `httpOnly` because nothing in the browser needs to read it, and `lax` so it
 * still arrives on the top-level navigation back from a sign-in.
 */
export const applyDeviceCookie = (
  response: NextResponse,
  deviceId: string,
): NextResponse => {
  response.cookies.set(DID_COOKIE, deviceId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: DID_MAX_AGE,
  });
  return response;
};
