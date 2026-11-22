//@ts-check

/**
 * A docs site is files (entifix ADR 0031 §3): a static export with a trailing
 * slash on every address, so each page is `…/index.html` and any static host
 * serves it. Every page is generated at build time from the registers, which
 * are workspace TypeScript with no build of their own, so they are transpiled
 * here.
 *
 * @type {import('next').NextConfig}
 **/
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  transpilePackages: ['@r10c/capabilities', '@r10c/slices'],
  webpack: config => {
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] };
    return config;
  },
};

module.exports = nextConfig;
