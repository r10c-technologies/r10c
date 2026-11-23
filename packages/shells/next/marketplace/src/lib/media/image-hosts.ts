import type { MediaImageLoader } from '@entifix/react-controls/primitives';

/**
 * Which hosts the storefront's image optimizer may fetch a vendor's picture
 * from (#571), and the loader that sends a picture through it.
 *
 * Next's optimizer runs inside the storefront, and every host on the list is
 * a fetch the storefront makes on a stranger's behalf, so the list is exact
 * hostnames and never `**`. It is `STOREFRONT_IMAGE_HOSTS`, comma-separated,
 * read by both this module and `next.config.js` (whose `remotePatterns` the
 * optimizer enforces). Unset, it is **empty**: the seeded sample stores'
 * pictures are the platform's own, served from `/samples/` on this origin
 * (#676), so a lab fetches nothing from anybody else's host. Where real
 * vendors' media will live is undecided; when it is, it is a value here, not
 * a code change.
 */
export const DEFAULT_IMAGE_HOSTS = '';

/** The optimizer's quality, the one `next.config.js` allows. */
export const IMAGE_QUALITY = 75;

const HOSTNAME =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/**
 * The hostnames in a comma-separated list, lower-cased. An entry that is not
 * a plain hostname (a wildcard, a port, a scheme, a path) is dropped rather
 * than widened into a pattern.
 */
export function parseImageHosts(raw: string): readonly string[] {
  return raw
    .split(',')
    .map(entry => entry.trim().toLowerCase())
    .filter(entry => HOSTNAME.test(entry));
}

/** The hosts this process allows, from its environment. */
export const imageHosts = (): readonly string[] =>
  parseImageHosts(process.env['STOREFRONT_IMAGE_HOSTS'] ?? DEFAULT_IMAGE_HOSTS);

/**
 * The loader for one picture: through the optimizer when its host is allowed
 * and it is served over `https`, and `undefined` otherwise, so an image on any
 * other host renders exactly as it did, its plain `src` and no `srcset`. A
 * vendor's picture never disappears for being somewhere unexpected.
 */
export function imageLoaderFor(
  src: string,
  hosts: readonly string[],
): MediaImageLoader | undefined {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' || !hosts.includes(url.hostname)) {
    return undefined;
  }
  return (source, width) =>
    `/_next/image?url=${encodeURIComponent(source)}&w=${width}&q=${IMAGE_QUALITY}`;
}
