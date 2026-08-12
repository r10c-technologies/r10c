import { DEFAULT_REDIRECT } from './session';

/**
 * Extra origins a sign-in may return to, comma-separated. `DEFAULT_REDIRECT` is
 * always allowed; this exists so a new `-app` can join the fleet by
 * configuration rather than by editing code.
 */
const EXTRA_ALLOWED = process.env.AUTH_ALLOWED_REDIRECTS ?? '';

const originsFrom = (value: string): string[] =>
  value
    .split(',')
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0)
    .flatMap(entry => {
      try {
        return [new URL(entry).origin];
      } catch {
        return [];
      }
    });

/** Every origin a post-sign-in redirect may land on. */
export const allowedRedirectOrigins = (selfOrigin?: string): string[] => [
  ...(selfOrigin === undefined ? [] : [new URL(selfOrigin).origin]),
  ...originsFrom(DEFAULT_REDIRECT),
  ...originsFrom(EXTRA_ALLOWED),
];

/**
 * Resolve a `?redirect=` value to somewhere it is safe to send a freshly
 * authenticated browser.
 *
 * An unchecked redirect parameter on a sign-in page is the textbook open
 * redirect: an attacker sends `…/?redirect=https://evil.example`, the victim
 * signs in for real, and the app itself forwards them onward — with the
 * credibility of having come from us. So the candidate must resolve to an origin
 * we published, and anything else silently falls back.
 *
 * A relative path is resolved against `selfOrigin`, because the only party that
 * writes one is the host's own middleware pointing at its own routes. Every
 * cross-app caller sends an absolute URL precisely so the two cannot be
 * confused.
 */
export const safeRedirect = (
  candidate: string | undefined | null,
  selfOrigin: string,
): string => {
  if (candidate === undefined || candidate === null || candidate === '') {
    return DEFAULT_REDIRECT;
  }

  let resolved: URL;
  try {
    resolved = new URL(candidate, selfOrigin);
  } catch {
    return DEFAULT_REDIRECT;
  }

  // Blocks `javascript:` and `data:` payloads, which parse happily but are not
  // navigations we want to perform on the user's behalf.
  if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
    return DEFAULT_REDIRECT;
  }

  return allowedRedirectOrigins(selfOrigin).includes(resolved.origin)
    ? resolved.toString()
    : DEFAULT_REDIRECT;
};
