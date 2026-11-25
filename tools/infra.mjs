/**
 * The up and down commands (ADR 0083 §5, #685; the runbook is
 * docs/DEVELOPING.md → "The cloud environment").
 *
 *   pnpm run infra:up -- --target lab            # the minikube rehearsal
 *   pnpm run infra:up -- --target gcp --dry-run  # print every step, run none
 *   pnpm run infra:down -- --target gcp
 *   pnpm run infra:forward -- --target lab       # the live pass's ports (#704)
 *   pnpm run infra:cost -- --target gcp --days 7 # the bill, per day (#705)
 *
 * A root script, as `generate-cluster.mjs` is, because it composes three
 * tools — the services from `tools/slices`, the apps from `tools/edge`, the
 * rendered workload names from `tools/cluster` — and no tool may import
 * another's source.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import './ts-source-resolver.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = path => pathToFileURL(join(REPO_ROOT, path)).href;

const { FLEET } = await import(p('tools/slices/src/fleet.ts'));
const { ORIGINS, upstreamOf } = await import(p('tools/edge/src/routes.ts'));
const { fleetManifests, workloads } = await import(
  p('tools/cluster/src/fleet.ts')
);
const { main } = await import(p('tools/infra/src/cli.ts'));

const inputs = {
  services: FLEET,
  apps: ORIGINS.map(origin => ({
    project: origin.app,
    port: upstreamOf(origin),
  })),
};
const deployments = workloads(inputs).map(workload => workload.name);
const names = new Set(
  Object.values(fleetManifests(inputs))
    .flat()
    .map(document => document.metadata.name),
);

try {
  main(process.argv.slice(2), REPO_ROOT, {
    projects: [...inputs.services, ...inputs.apps].map(
      ({ project }) => project,
    ),
    names,
    deployments,
    services: inputs.services,
  });
} catch (error) {
  console.error(
    `\n✗ ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
