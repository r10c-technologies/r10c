//@ts-check

/**
 * A plain Next config. `withNx`/`composePlugins` from `@nx/next` are deprecated
 * and removed in Nx 24, and supplied nothing here: this workspace declares no
 * tsconfig `paths`, so their `transpilePackages` list came out empty, and their
 * webpack hook never runs under Turbopack.
 *
 * @type {import('next').NextConfig}
 **/
const nextConfig = {};

module.exports = nextConfig;
