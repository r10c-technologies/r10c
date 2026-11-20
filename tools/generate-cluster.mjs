/**
 * Writes the fleet's rendered manifests into `infra/cluster/fleet/`, or checks
 * them (ADR 0083, #682).
 *
 *   pnpm nx run @r10c/cluster:generate             # rewrite in place
 *   pnpm nx run @r10c/cluster:generate -- --check  # fail when one is stale
 *
 * A root script, as `sync-docs.mjs` is, because it composes three tools — the
 * services from `tools/slices`, the apps and the YAML emitter from
 * `tools/edge`, the renderer from `tools/cluster` — and no tool may import
 * another's source. `@r10c/docs-check` asserts the same equality in CI, so a
 * hand-edit to a rendered file fails the build whether or not this was run. A
 * rendered file the generator no longer produces is removed, so a service
 * dropped from the register does not leave a workload behind.
 */
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import './ts-source-resolver.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = path => pathToFileURL(join(REPO_ROOT, path)).href;

const { FLEET } = await import(p('tools/slices/src/fleet.ts'));
const { ORIGINS, upstreamOf } = await import(p('tools/edge/src/routes.ts'));
const { toYaml, toYamlStream } = await import(p('tools/edge/src/yaml.ts'));
const { FLEET_DIR, renderCluster } = await import(
  p('tools/cluster/src/render.ts')
);

const inputs = {
  services: FLEET,
  apps: ORIGINS.map(origin => ({
    project: origin.app,
    port: upstreamOf(origin),
  })),
};

const current = path => {
  try {
    return readFileSync(join(REPO_ROOT, path), 'utf8');
  } catch {
    return undefined;
  }
};

const onDisk = () => {
  try {
    return readdirSync(join(REPO_ROOT, FLEET_DIR)).map(
      file => `${FLEET_DIR}/${file}`,
    );
  } catch {
    return [];
  }
};

const check = process.argv.includes('--check');
const files = await renderCluster(REPO_ROOT, inputs, { toYaml, toYamlStream });
const stale = Object.entries(files).filter(
  ([path, text]) => current(path) !== text,
);
const orphaned = onDisk().filter(path => !(path in files));

if (check) {
  if (stale.length > 0 || orphaned.length > 0) {
    console.error(
      `cluster: stale or orphaned rendered files:\n  ${[...stale.map(([path]) => path), ...orphaned].join('\n  ')}\n\n` +
        'Change FLEET, ORIGINS or tools/cluster/src/fleet.ts, then run `pnpm nx run @r10c/cluster:generate`.',
    );
    process.exit(1);
  }
  console.log(
    `cluster: ${String(Object.keys(files).length)} rendered files are current.`,
  );
} else {
  for (const [path, text] of stale) {
    mkdirSync(dirname(join(REPO_ROOT, path)), { recursive: true });
    writeFileSync(join(REPO_ROOT, path), text);
    console.log(`cluster: wrote ${path}`);
  }
  for (const path of orphaned) {
    rmSync(join(REPO_ROOT, path));
    console.log(`cluster: removed ${path}`);
  }
  if (stale.length === 0 && orphaned.length === 0)
    console.log('cluster: nothing to write.');
}
