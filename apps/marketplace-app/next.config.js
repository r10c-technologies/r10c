//@ts-check

const { join } = require('node:path');

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
 * `STOREFRONT_IMAGE_HOSTS`, comma-separated exact hostnames, none when unset:
 * the sample stores' pictures are served from this origin's `/samples/`
 * (#676) and need no optimizer fetch. The shell's `media/image-hosts.ts` reads the same variable
 * with the same default and parsing, so a picture is only ever sent through
 * the optimizer to a host this list lets it fetch; `next.config.spec.ts`
 * holds the two to each other. Never `**`: every host here is a fetch the
 * storefront makes on a stranger's behalf.
 */
const HOSTNAME =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const imageHosts = (process.env.STOREFRONT_IMAGE_HOSTS ?? '')
  .split(',')
  .map(entry => entry.trim().toLowerCase())
  .filter(entry => HOSTNAME.test(entry));

/**
 * The page a mailed access link opens carries its one-time token in the query
 * string, so nothing it loads may send that address on as a `Referer`
 * (ADR 0076 §6). The page's own metadata says the same for the document.
 *
 * ⚠️ `strict-origin`, never `no-referrer`: under `no-referrer` a browser posts
 * the page's form with `Origin: null`, Next's CSRF check refuses the Server
 * Action, and redeeming the link worked only with script (#725). The origin
 * alone is sent — never the path, so never the token.
 */
const ORIGIN_ONLY = [{ key: 'Referrer-Policy', value: 'strict-origin' }];

const nextConfig = {
  // A self-contained server for the container image (ADR 0083, #682):
  // `.next/standalone` holds `server.js` and only the files a trace says it
  // reads, so `tools/docker/next.Dockerfile` copies that and the static assets
  // and installs nothing. The trace starts at the repository root because the
  // workspace packages live outside this app. `next start`, which the e2e
  // webServer and the local fleet use, still serves the same build.
  output: 'standalone',
  outputFileTracingRoot: join(__dirname, '../..'),
  headers: async () => [
    { source: '/:locale/order/access', headers: ORIGIN_ONLY },
  ],
  // Partial prerendering (#346): each route's static shell is prerendered and
  // what reads the catalog, a cookie or the query streams into it. The
  // catalog's cache lifetime is the shell's `CATALOG_CACHE`, short enough
  // that no catalog read is baked in at build time (ADR 0051).
  cacheComponents: true,
  // A payment receipt is up to 5 MB (ADR 0081 §7), posted to a Server Action
  // as a form: Next's 1 MB default plus framing would refuse it before the
  // service could say why. order-service holds the real limit.
  experimental: { serverActions: { bodySizeLimit: '6mb' } },
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
