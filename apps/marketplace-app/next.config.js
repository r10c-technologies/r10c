//@ts-check

/**
 * A plain Next config. `withNx`/`composePlugins` from `@nx/next` are deprecated
 * and removed in Nx 24, and supplied nothing here: this workspace declares no
 * tsconfig `paths`, so their `transpilePackages` list came out empty, and their
 * webpack hook never runs under Turbopack.
 *
 * @type {import('next').NextConfig}
 **/
/**
 * The hosts the image optimizer may fetch a vendor's picture from (#571):
 * `STOREFRONT_IMAGE_HOSTS`, comma-separated exact hostnames, the seed's one
 * host when unset. The shell's `media/image-hosts.ts` reads the same variable
 * with the same default and parsing, so a picture is only ever sent through
 * the optimizer to a host this list lets it fetch; `next.config.spec.ts`
 * holds the two to each other. Never `**`: every host here is a fetch the
 * storefront makes on a stranger's behalf.
 */
const HOSTNAME =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const imageHosts = (process.env.STOREFRONT_IMAGE_HOSTS ?? 'picsum.photos')
  .split(',')
  .map(entry => entry.trim().toLowerCase())
  .filter(entry => HOSTNAME.test(entry));

/**
 * The page a mailed access link opens carries its one-time token in the query
 * string, so nothing it loads may send that address on as a `Referer`
 * (ADR 0076 §6). The page's own metadata says the same for the document.
 */
const NO_REFERRER = [{ key: 'Referrer-Policy', value: 'no-referrer' }];

const nextConfig = {
  headers: async () => [
    { source: '/:locale/order/access', headers: NO_REFERRER },
  ],
  // Partial prerendering (#346): each route's static shell is prerendered and
  // what reads the catalog, a cookie or the query streams into it. The
  // catalog's cache lifetime is the shell's `CATALOG_CACHE`, short enough
  // that no catalog read is baked in at build time (ADR 0051).
  cacheComponents: true,
  images: {
    remotePatterns: imageHosts.map(hostname => ({
      protocol: 'https',
      hostname,
      pathname: '/**',
    })),
    // The widths entifix's `MediaImage` asks a loader for
    // (`MEDIA_IMAGE_WIDTHS`): the optimizer refuses any `w` it does not list.
    deviceSizes: [320, 480, 640, 960, 1280, 1920],
    qualities: [75],
  },
};

module.exports = nextConfig;
