#!/usr/bin/env node
/**
 * Rewrites the documentation blocks that are derived from executable truth.
 *
 *   node tools/sync-docs.mjs            # rewrite the blocks in place
 *   node tools/sync-docs.mjs --check    # fail if any block is stale (CI + hook)
 *
 * A block is the text between `<!-- docs:begin <name> -->` and
 * `<!-- docs:end <name> -->`. Everything outside the markers is hand-written and
 * never touched — footnotes, the `⚠️` annotations, and the prose that explains
 * why a table says what it says all live outside on purpose. Only the rows are
 * generated, because only the rows have a source that can disagree with them.
 *
 * Three blocks today:
 *
 *   ports-infra     docs/_shared/ports.md   ← infra/local/lib.sh
 *   store-register  docs/_shared/planes.md  ← tools/slices/
 *   adr-index       docs/adr/README.md      ← the ADR files themselves
 *
 * Everything is run through Prettier before it is compared or written. Markdown
 * is formatted by `lint-staged` on commit and Prettier realigns pipe tables, so
 * a generator that emitted its own alignment would be reformatted immediately
 * and `--check` would never go green again.
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import prettier from 'prettier';

import './ts-source-resolver.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...parts) => join(REPO_ROOT, ...parts);

/* ------------------------------------------------------------------ helpers */

/** Read a bash array literal (`NAME=( "a" "b" )`) out of a shell script. */
const bashArray = (text, name) => {
  const match = text.match(new RegExp(`^${name}=\\(([^)]*)\\)`, 'm'));
  if (!match) throw new Error(`sync-docs: ${name} not found`);
  return [...match[1].matchAll(/"([^"]+)"|'([^']+)'|(\S+)/g)]
    .map(m => m[1] ?? m[2] ?? m[3])
    .filter(Boolean);
};

/** Read a scalar assignment (`NAME=value` or `NAME="value"`). */
const bashScalar = (text, name) => {
  const match = text.match(new RegExp(`^${name}="?([^"\\n]+)"?`, 'm'));
  if (!match) throw new Error(`sync-docs: ${name} not found`);
  return match[1].trim();
};

const table = (headers, rows) =>
  [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map(cells => `| ${cells.join(' | ')} |`),
  ].join('\n');

/* ------------------------------------------------------------- ports-infra */

/**
 * The NodePorts the local lab publishes to the host.
 *
 * `PORT_SPECS` is the list the health ladder probes; `MINIKUBE_PORTS` is the
 * full host→node mapping, which is strictly larger — it carries the ports
 * nothing probes (RabbitMQ management, Grafana, OTLP/gRPC, Mailpit's web UI).
 * Both are rendered, because a reader looking up "which port is Grafana on"
 * needs the second list and a reader debugging readiness needs the first.
 */
const portsInfra = () => {
  const lib = readFileSync(p('infra/local/lib.sh'), 'utf8');
  const probed = new Map(
    bashArray(lib, 'PORT_SPECS').map(spec => {
      const [label, port, deployment] = spec.split(':');
      return [port, { label, deployment }];
    }),
  );
  const loginPort = bashScalar(lib, 'LOGIN_NODEPORT');
  probed.set(loginPort, {
    label: 'zitadel-login',
    deployment: bashScalar(lib, 'LOGIN_DEPLOYMENT'),
  });

  // Names for the published-but-unprobed ports. These are host-facing UIs and
  // secondary protocols, so they are labelled here rather than in lib.sh, which
  // only needs the ones it probes.
  const extras = {
    31672: 'rabbitmq management UI',
    30000: 'grafana (otel-lgtm)',
    30317: 'OTLP/gRPC (otel-lgtm)',
    30826: 'mailpit web UI',
  };

  const published = bashScalar(lib, 'MINIKUBE_PORTS')
    .split(',')
    .map(pair => pair.split(':')[0]);

  // A port the ladder probes but the VM never publishes is unreachable from the
  // host: the probe fails forever and the fleet never comes up. Catching it here
  // is cheap, and the alternative is a row quietly missing from the table.
  const unpublished = [...probed.keys()].filter(
    port => !published.includes(port),
  );
  if (unpublished.length) {
    throw new Error(
      `these ports are probed but absent from MINIKUBE_PORTS, so nothing on the ` +
        `host can reach them: ${unpublished.join(', ')} ` +
        `(add them to MINIKUBE_PORTS in infra/local/lib.sh)`,
    );
  }

  const rows = published.map(port => {
    const hit = probed.get(port);
    return hit
      ? [`\`${port}\``, hit.label, `\`${hit.deployment}\``, '✅']
      : [`\`${port}\``, extras[port] ?? '—', '—', '—'];
  });

  return table(
    ['Host port', 'Datastore / UI', 'Deployment', 'Probed by the ladder'],
    rows,
  );
};

/* ---------------------------------------------------------- store-register */

const storeRegister = async () => {
  const { SLICES } = await import(p('tools/slices/src/registry.ts'));

  const rows = SLICES.flatMap(slice =>
    slice.stores.map(store => [
      `\`${store.name}\``,
      store.plane,
      `\`${slice.name}\``,
      slice.status === 'planned' ? '**planned**' : 'active',
      slice.coDeployedWith.length
        ? slice.coDeployedWith.map(n => `\`${n}\``).join(', ')
        : '—',
      store.hosts.length
        ? store.hosts.map(h => `\`${h}\``).join(' **+** ') +
          (store.bindingReason ? ' ⚠️' : '')
        : '—',
      store.partitioning,
      store.truth === 'system-of-record'
        ? 'system-of-record'
        : `\`${store.truth}\``,
    ]),
  ).sort((a, b) => a[0].localeCompare(b[0]));

  return table(
    [
      'Store',
      'Plane',
      'Owner slice',
      'Slice status',
      'Co-deployed with',
      'Hosts',
      'Partitioning',
      'Truth',
    ],
    rows,
  );
};

/* -------------------------------------------------------------- adr-index */

/**
 * The ADR index, which is a consistency dashboard rather than a list.
 *
 * The `Revised by` column is the point. This repo's policy keeps a record
 * `Accepted` when only a *section* of it was superseded, so `Status` alone
 * cannot distinguish "fully binding" from "binding except three sections" —
 * and a reader who cannot see that difference is exactly how ADR 0004 went on
 * describing a deleted password-reset flow for a week.
 */
const adrIndex = async () => {
  // The reader is shared with `@r10c/docs-check`, which asserts that every
  // supersession is symmetric. Two implementations of "which records revised
  // this one" could disagree, and then the dashboard would contradict the check
  // meant to keep it honest — the drift this whole file exists to prevent.
  const { adrs } = await import(p('tools/docs/src/corpus.ts'));
  const records = adrs();
  const fileFor = id => records.find(record => record.id === id)?.file;

  const rows = records.map(record => {
    const date = record.text.match(/^- Date:\s*(\S+)/m);
    const marks = [...record.revisedBy].sort();

    return [
      `[${record.id}](${record.file})`,
      record.title,
      record.status,
      date?.[1] ?? '—',
      marks.length
        ? marks.map(id => `[${id}](${fileFor(id) ?? ''})`).join(', ')
        : // An undated in-place correction that names no ADR — ADR 0003's
          // rollup clarification, which no other record drove.
          /^- Revised: \d{4}-\d{2}-\d{2}\s*—/m.test(record.text)
          ? 'in place'
          : '—',
    ];
  });

  return table(['#', 'Title', 'Status', 'Date', 'Revised by'], rows);
};

/* ------------------------------------------------------------------ driver */

/**
 * The generated blocks, and the single place they are declared.
 *
 * Exported because two documents also describe this list in prose — `CLAUDE.md`
 * and DEVELOPING.md's "Keeping the documentation true" — and `@r10c/docs-check`
 * asserts those descriptions against **this** array. Adding a fourth block
 * therefore fails the build until both are updated, which is the only way a list
 * that exists in three places stays true. Nothing else compares docs to docs.
 */
export const BLOCKS = [
  { name: 'ports-infra', file: 'docs/_shared/ports.md', render: portsInfra },
  {
    name: 'store-register',
    file: 'docs/_shared/planes.md',
    render: storeRegister,
  },
  { name: 'adr-index', file: 'docs/adr/README.md', render: adrIndex },
];

const format = async (text, filepath) =>
  prettier.format(text, {
    ...(await prettier.resolveConfig(filepath)),
    filepath,
  });

const main = async () => {
  const check = process.argv.includes('--check');
  const stale = [];

  for (const block of BLOCKS) {
    const filepath = p(block.file);
    const original = readFileSync(filepath, 'utf8');
    const begin = `<!-- docs:begin ${block.name} -->`;
    const end = `<!-- docs:end ${block.name} -->`;

    const from = original.indexOf(begin);
    const to = original.indexOf(end);
    if (from === -1 || to === -1) {
      throw new Error(
        `sync-docs: ${block.file} is missing the ${block.name} markers ` +
          `(${begin} … ${end})`,
      );
    }

    const body = await block.render();
    const next = await format(
      `${original.slice(0, from + begin.length)}\n\n${body}\n\n${original.slice(to)}`,
      filepath,
    );

    if (next === original) continue;
    if (check) stale.push(block);
    else {
      writeFileSync(filepath, next);
      console.log(`sync-docs: rewrote ${block.name} in ${block.file}`);
    }
  }

  if (!stale.length) {
    console.log(
      check
        ? `sync-docs: ${BLOCKS.length} generated blocks are current.`
        : 'sync-docs: done.',
    );
    return;
  }

  console.error('sync-docs: generated blocks are stale.\n');
  for (const block of stale) {
    console.error(`  ✗ ${block.name}  (${block.file})`);
  }
  console.error(
    '\nThese blocks are written from source, not by hand. Change the source' +
      '\n(infra/local/lib.sh, tools/slices/, or the ADR files), then run:' +
      '\n\n    node tools/sync-docs.mjs\n\nand stage the result.',
  );
  process.exit(1);
};

// Only when run as a script. `@r10c/docs-check` imports `BLOCKS` from this
// file, and an unguarded call would rewrite the documentation as a side effect
// of running the test suite.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(error => {
    console.error(`sync-docs: ${error.message}`);
    process.exit(1);
  });
}
