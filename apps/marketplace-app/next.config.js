//@ts-check

/**
 * A plain Next config. `withNx`/`composePlugins` from `@nx/next` are deprecated
 * and removed in Nx 24, and supplied nothing here: this workspace declares no
 * tsconfig `paths`, so their `transpilePackages` list came out empty, and their
 * webpack hook never runs under Turbopack.
 *
 * @type {import('next').NextConfig}
 **/
const nextConfig = {
  // Partial prerendering (#346): each route's static shell is prerendered and
  // what reads the catalog, a cookie or the query streams into it. The
  // catalog's cache lifetime is the shell's `CATALOG_CACHE`, short enough
  // that no catalog read is baked in at build time (ADR 0051).
  cacheComponents: true,
};

module.exports = nextConfig;
