'use strict';

/**
 * The webpack `externals` entry every service bundle is built with: it keeps
 * each named package **and every subpath of it** out of the bundle.
 *
 * `NxAppWebpackPlugin`'s own `externalDependencies` matches a request exactly,
 * so `'effect'` kept `require("effect")` external while `effect/http`,
 * `effect/sql` and `effect/http-api` were bundled — two copies of effect in one
 * process. Schema's sentinels are module-level symbols, so a codec built by one
 * copy and run by the other handed `JsonBody` a bare `Symbol()` to encode, and
 * every `GET /api/config/:service` answered 500.
 *
 * Plain CommonJS outside every project, as `sync-docs.mjs` is, so a webpack
 * config loads it without a build and Nx infers no app→tool edge from the
 * `require`; `tools/conventions/src/webpack-externals.spec.ts` checks it and
 * that every service config uses it.
 */
const externalPackages = packages => (data, callback) => {
  const { request } = data;
  return packages.some(
    name => request === name || request.startsWith(`${name}/`),
  )
    ? callback(null, `commonjs ${request}`)
    : callback();
};

module.exports = { externalPackages };
