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
const nextConfig = {
  // A self-contained server for the container image (ADR 0083, #682):
  // `.next/standalone` holds `server.js` and only the files a trace says it
  // reads, so `tools/docker/next.Dockerfile` copies that and the static assets
  // and installs nothing. The trace starts at the repository root because the
  // workspace packages live outside this app. `next start`, which the e2e
  // webServer and the local fleet use, still serves the same build.
  output: 'standalone',
  outputFileTracingRoot: join(__dirname, '../..'),
};

module.exports = nextConfig;
