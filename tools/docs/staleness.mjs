#!/usr/bin/env node
/**
 * Reports code that changed without its documentation changing.
 *
 *   node tools/docs/staleness.mjs [--base <ref>] [--head <ref>]
 *
 * **Advisory, never blocking**, and that is a design decision rather than
 * timidity. This check can only see that a doc was *not touched*; it cannot see
 * whether the doc is *wrong*. Failing a build on it teaches everyone to make a
 * trivial edit to whatever file it names, which produces green builds and worse
 * documentation. The checks that block — `tools/sync-docs.mjs --check` and
 * `@r10c/docs-check` — are the ones that compare a claim against its source.
 *
 * Writes to `$GITHUB_STEP_SUMMARY` when it exists, stdout otherwise. Deliberately
 * not a PR comment: a comment needs `pull-requests: write`, and a bot that posts
 * on every push is a thing people learn to scroll past.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

/**
 * Which documents own which parts of the tree.
 *
 * Hand-written on purpose. The knowledge graph in `graphify-out/` models
 * doc↔code edges, but its `affected` traversal is undirected and attaches doc
 * edges to concept nodes rather than symbol nodes, so asking it "which docs does
 * this file touch" returns nothing. Measured, not assumed — do not spend a round
 * trying to replace this map with it.
 */
const OWNERSHIP = [
  {
    match: /^packages\/business\/ts\//,
    docs: ['docs/BUSINESS-ARCHITECTURE.md', 'docs/adr/'],
    why: 'a domain, an entity or a use-case changed',
  },
  {
    match: /^packages\/entifix\/ts\/(core|business)\//,
    docs: ['docs/ENTIFIX.md'],
    why: 'the entity framework or the adapter contract changed',
  },
  {
    match: /^packages\/entifix\/react\/|^packages\/shells\/next\//,
    docs: ['docs/FRONTEND.md'],
    why: 'the client surface changed',
  },
  {
    match: /^packages\/entifix\/ts\/i18n\//,
    docs: ['docs/I18N.md'],
    why: 'the i18n layer changed',
  },
  {
    match: /^infra\/local\//,
    docs: [
      'docs/_shared/ports.md',
      'docs/_shared/planes.md',
      'infra/local/README.md',
    ],
    why: 'the local platform changed',
  },
  {
    match: /^apps\/[^/]+\/(?!.*-e2e)/,
    docs: ['docs/ARCHITECTURE.md', 'docs/_shared/ports.md'],
    why: 'a deployment changed',
  },
  {
    match: /^tools\/slices\//,
    docs: ['docs/_shared/planes.md', 'docs/adr/'],
    why: 'the store register changed',
  },
  {
    match: /^(nx\.json|tsconfig\.base\.json|eslint\.config\.mjs)$/,
    docs: ['docs/DEVELOPING.md', 'docs/_shared/layering.md'],
    why: 'the workspace configuration changed',
  },
];

/** Accepts both `--base <ref>` and `--base=<ref>`; CI passes the latter. */
const arg = name => {
  const inline = process.argv.find(a => a.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};

const changed = () => {
  const base = arg('--base') ?? 'origin/main';
  const head = arg('--head') ?? 'HEAD';
  try {
    return execFileSync('git', ['diff', '--name-only', `${base}...${head}`], {
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean);
  } catch {
    console.error(`staleness: cannot diff ${base}...${head}; skipping.`);
    return [];
  }
};

const files = changed();
if (!files.length) process.exit(0);

const touched = doc =>
  files.some(file => (doc.endsWith('/') ? file.startsWith(doc) : file === doc));

const findings = OWNERSHIP.filter(rule => files.some(f => rule.match.test(f)))
  .filter(rule => !rule.docs.some(touched))
  .map(rule => ({
    why: rule.why,
    docs: rule.docs,
    examples: files.filter(f => rule.match.test(f)).slice(0, 3),
  }));

const lines = findings.length
  ? [
      '## Documentation staleness (advisory)',
      '',
      'These areas changed without their documentation being touched. That is',
      'often fine — a bugfix is not doc-worthy. It is here so the decision is',
      'made rather than skipped.',
      '',
      '| Changed | Suggests reviewing | Example files |',
      '| --- | --- | --- |',
      ...findings.map(
        f =>
          `| ${f.why} | ${f.docs.map(d => `\`${d}\``).join(', ')} | ${f.examples
            .map(e => `\`${e}\``)
            .join('<br>')} |`,
      ),
      '',
      '_Advisory only. The blocking checks are `node tools/sync-docs.mjs --check`',
      'and `pnpm nx test @r10c/docs-check`._',
    ]
  : [
      '## Documentation staleness (advisory)',
      '',
      'Nothing to flag: every area this diff touches had its documentation',
      'reviewed, or owns none.',
    ];

const report = `${lines.join('\n')}\n`;

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
}
console.log(report);
