'use strict';

/**
 * Fails a service's image build when its bundle requires a package its pruned
 * `package.json` would not install (#685).
 *
 * A service's `dist` is a webpack bundle with its heavy dependencies kept
 * external, and `<service>:prune` writes a `package.json` of what the image
 * installs. The two are derived from different things — the bundle from the
 * import graph, the manifest from the project's own declared dependencies — so
 * a package reached only through a shared shell is required at run time and
 * installed by nothing. The lab never notices, because the workspace's
 * `node_modules` has everything; the image does, at boot, as
 * `Cannot find module`. transaction-service shipped that way for `mongodb`.
 *
 *   node tools/docker/check-installs.cjs apps/<service>/dist
 *
 * Plain CommonJS outside every project, as `webpack-externals.cjs` is, and
 * run by each service's `container` target before `docker build`.
 */
const { readdirSync, readFileSync } = require('node:fs');
const { builtinModules } = require('node:module');
const { join } = require('node:path');

const packageOf = request =>
  request.startsWith('@')
    ? request.split('/').slice(0, 2).join('/')
    : request.split('/')[0];

const missingInstalls = dist => {
  const manifest = JSON.parse(readFileSync(join(dist, 'package.json'), 'utf8'));
  const installed = new Set(Object.keys(manifest.dependencies ?? {}));
  const builtin = new Set(builtinModules);
  const required = new Set();
  for (const file of readdirSync(dist).filter(name => name.endsWith('.js')))
    for (const [, request] of readFileSync(join(dist, file), 'utf8').matchAll(
      /require\("([^".][^"]*)"\)/g,
    ))
      if (!request.startsWith('node:') && !builtin.has(packageOf(request)))
        required.add(packageOf(request));
  return [...required].filter(name => !installed.has(name)).sort();
};

module.exports = { missingInstalls };

if (require.main === module) {
  const dist = process.argv[2];
  const missing = missingInstalls(dist);
  if (missing.length > 0) {
    console.error(
      `${dist}: the bundle requires what the image would not install: ${missing.join(', ')}.\n` +
        "Declare each in the service's package.json dependencies.",
    );
    process.exit(1);
  }
}
