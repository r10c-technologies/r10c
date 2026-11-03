/**
 * Writes the edge's rendered files, or checks them.
 *
 *   pnpm nx run @r10c/edge:generate             # rewrite in place
 *   pnpm nx run @r10c/edge:generate -- --check  # fail when one is stale
 *
 * `@r10c/docs-check` asserts the same equality in CI, so a hand-edit to a
 * rendered file fails the build whether or not this was run.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderEdge } from './render.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

const current = (path: string): string | undefined => {
  try {
    return readFileSync(join(REPO_ROOT, path), 'utf8');
  } catch {
    return undefined;
  }
};

const check = process.argv.includes('--check');
const files = await renderEdge(REPO_ROOT);
const stale = Object.entries(files).filter(
  ([path, text]) => current(path) !== text,
);

if (check) {
  if (stale.length > 0) {
    console.error(
      `edge: stale rendered files:\n  ${stale.map(([path]) => path).join('\n  ')}\n\n` +
        'Change tools/edge/src/routes.ts, then run `pnpm nx run @r10c/edge:generate`.',
    );
    process.exit(1);
  }
  console.log(
    `edge: ${String(Object.keys(files).length)} rendered files are current.`,
  );
} else {
  for (const [path, text] of stale) {
    mkdirSync(dirname(join(REPO_ROOT, path)), { recursive: true });
    writeFileSync(join(REPO_ROOT, path), text);
    console.log(`edge: wrote ${path}`);
  }
  if (stale.length === 0) console.log('edge: nothing to write.');
}
