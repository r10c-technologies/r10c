/**
 * `pnpm run dev-infra:map` — walk the running fleet's `GET /api/$service`
 * endpoints, print what each process is actually wired to, and diff that against
 * what `tools/slices/` declares.
 *
 * A read-only sibling of `infra/local/doctor.sh`: it starts nothing, changes
 * nothing, and a service that is simply not running is reported as `SKIP`
 * rather than as a failure.
 *
 * **The diff is the point** (ADR 0031). The register already checks its
 * declarations against each other and against a source scan; what nothing could
 * do is compare a declaration to what a process *did*, because a source scan
 * cannot see emission. Without this reader the endpoint would be a generated
 * artifact nobody queries, which is the thing this repository has already
 * deleted once.
 *
 *   node tools/fleet-map.mjs             print the map
 *   node tools/fleet-map.mjs --check     print it, then exit 1 on a violation
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import './ts-source-resolver.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Same default as `shells-effect-service`, so a local run needs no env. */
const SERVICE_TOKEN =
  process.env.CONFIG_SERVICE_TOKEN ?? 'dev-config-service-token-change-me';

const ESC = '\u001B[';
const HAS_COLOR = process.stdout.isTTY;
const c = (code, text) => (HAS_COLOR ? `${ESC}${code}m${text}${ESC}0m` : text);
const dim = text => c('2', text);
const red = text => c('31', text);
const yellow = text => c('33', text);
const green = text => c('32', text);
const bold = text => c('1', text);

/** Fetch one service's description, or `null` when nothing is listening. */
const describeService = async ({ project, port }) => {
  const url = `http://localhost:${port}/api/$service`;
  try {
    const response = await fetch(url, {
      headers: { 'x-service-token': SERVICE_TOKEN },
      signal: AbortSignal.timeout(3_000),
    });
    if (response.status === 401) {
      return { project, port, error: 'service token rejected (401)' };
    }
    if (!response.ok) {
      return { project, port, error: `HTTP ${response.status}` };
    }
    return { project, port, description: await response.json() };
  } catch {
    return { project, port, absent: true };
  }
};

/**
 * Compare one service's description to what the register declares for the
 * slices it says it hosts.
 *
 * Only one direction fails: something **observed** that is not **declared**. The
 * reverse — declared and never observed — is advisory, because a fleet that has
 * just booted has published nothing, and asserting it would mean the diff only
 * passes after every flow has been exercised.
 */
const diffService = (result, slices, matchesPattern) => {
  const violations = [];
  const advisories = [];
  const { project, description } = result;
  const hosted = [];

  for (const name of description.slices) {
    const slice = slices.find(candidate => candidate.name === name);
    if (slice === undefined) {
      violations.push(
        `${project}: hosts slice '${name}', which no *.slice.ts declares`,
      );
      continue;
    }
    if (!slice.deployments.includes(project)) {
      violations.push(
        `${project}: hosts slice '${name}', whose deployments are [${slice.deployments.join(', ')}]`,
      );
    }
    hosted.push(slice);
  }

  const declaredStores = hosted.flatMap(slice =>
    slice.stores.map(store => store.name),
  );
  const declaredPublished = hosted.flatMap(slice => slice.publishedEvents);
  const declaredSubscriptions = hosted.flatMap(slice => slice.subscriptions);

  for (const store of description.stores) {
    if (!declaredStores.includes(store.name)) {
      violations.push(
        `${project}: opened store '${store.name}' (probe ${store.probe}), which no hosted slice declares`,
      );
    }
  }

  for (const name of description.published) {
    if (!declaredPublished.some(pattern => matchesPattern(pattern, name))) {
      violations.push(
        `${project}: emitted '${name}', which no hosted slice declares`,
      );
    }
  }

  for (const bound of description.subscriptions) {
    const declared = declaredSubscriptions.find(
      candidate =>
        candidate.event === bound.pattern && candidate.mode === bound.mode,
    );
    if (declared === undefined) {
      violations.push(
        `${project}: bound queue '${bound.queue}' on '${bound.pattern}' (${bound.mode}), which no hosted slice declares`,
      );
    }
  }

  // Advisory half — the drift a source scan could never see, reported rather
  // than asserted.
  for (const slice of hosted) {
    for (const store of slice.stores) {
      if (!description.stores.some(opened => opened.name === store.name)) {
        advisories.push(
          `${slice.name}: store '${store.name}' — no handle opened`,
        );
      }
    }
    for (const pattern of slice.publishedEvents) {
      if (!description.published.some(name => matchesPattern(pattern, name))) {
        advisories.push(
          `${slice.name}: publishes '${pattern}' — never observed`,
        );
      }
    }
    for (const subscription of slice.subscriptions) {
      if (
        !description.subscriptions.some(
          bound =>
            bound.pattern === subscription.event &&
            bound.mode === subscription.mode,
        )
      ) {
        advisories.push(
          `${slice.name}: subscribes '${subscription.event}' (${subscription.mode}) — no queue bound`,
        );
      }
    }
  }

  return { violations, advisories };
};

const printService = result => {
  const { project, port } = result;
  if (result.absent) {
    console.log(`${dim('SKIP')}  ${project} ${dim(`:${port} not listening`)}`);
    return;
  }
  if (result.error !== undefined) {
    console.log(
      `${red('FAIL')}  ${project} ${dim(`:${port}`)} — ${result.error}`,
    );
    return;
  }
  const d = result.description;
  console.log(
    `${green('OK')}    ${bold(project)} ${dim(`:${port}`)}  slices: ${d.slices.join(', ')}`,
  );
  const line = (label, values) => {
    if (values.length > 0) {
      console.log(`        ${dim(label.padEnd(14))}${values.join(', ')}`);
    }
  };
  line(
    'stores',
    d.stores.map(store => store.name),
  );
  line(
    'brokers',
    d.brokers.map(broker => broker.name),
  );
  line(
    'upstreams',
    d.upstreams.map(upstream => upstream.name),
  );
  line('publishes', d.published);
  line(
    'subscribes',
    d.subscriptions.map(
      bound => `${bound.pattern} (${bound.mode} -> ${bound.queue})`,
    ),
  );
};

const main = async () => {
  const check = process.argv.includes('--check');
  // The register and the fleet table, imported live rather than copied — the
  // same trick `tools/sync-docs.mjs` uses, through `ts-source-resolver.mjs`.
  const { SLICES } = await import(
    join(REPO_ROOT, 'tools/slices/src/registry.ts')
  );
  const { FLEET, matchesPattern } = await import(
    join(REPO_ROOT, 'tools/slices/src/fleet.ts')
  );

  console.log();
  console.log(
    `${bold('fleet map')}  ${dim('declared: tools/slices/  observed: GET /api/$service')}`,
  );
  console.log();

  const results = await Promise.all(FLEET.map(describeService));
  for (const result of results) printService(result);

  const violations = [];
  const advisories = [];
  for (const result of results) {
    if (result.description === undefined) {
      if (result.error !== undefined && check) {
        violations.push(`${result.project}: ${result.error}`);
      }
      continue;
    }
    const diff = diffService(result, SLICES, matchesPattern);
    violations.push(...diff.violations);
    advisories.push(...diff.advisories);
  }

  console.log();
  for (const advisory of advisories) {
    console.log(`${yellow('advisory')}    ${advisory}`);
  }
  for (const violation of violations) {
    console.log(`${red('undeclared')}  ${violation}`);
  }
  if (advisories.length === 0 && violations.length === 0) {
    console.log(dim('declared and observed agree'));
  }
  console.log();

  if (check && violations.length > 0) {
    console.error(
      `${violations.length} observed thing(s) that no slice declares.\n` +
        'Declare it in tools/slices/, or stop doing it.',
    );
    process.exit(1);
  }
};

if (
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  await main();
}
