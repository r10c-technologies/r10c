/**
 * Writes the sample stores' pictures into each serving app's `public/`, or
 * checks them.
 *
 *   pnpm nx run @r10c/sample-media:generate             # rewrite in place
 *   pnpm nx run @r10c/sample-media:generate -- --check  # fail when one is stale
 *
 * The pictures are committed, so a container build, a CI run and a fresh
 * checkout serve them with no step of their own. `sample-media.spec.ts`
 * asserts the same equality on every CI run, so a hand-edit or a product
 * added without its picture fails the build whether or not this was run.
 */
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderSampleMedia, SERVING_APPS } from './render.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

const current = (path: string): string | undefined => {
  try {
    return readFileSync(join(REPO_ROOT, path), 'utf8');
  } catch {
    return undefined;
  }
};

/** Every file under each app's `public/samples/`, as repository paths. */
const committed = (): string[] =>
  SERVING_APPS.flatMap(app => {
    const root = join(REPO_ROOT, app, 'public/samples');
    try {
      return readdirSync(root, { recursive: true, withFileTypes: true })
        .filter(entry => entry.isFile())
        .map(entry =>
          join(entry.parentPath, entry.name).slice(REPO_ROOT.length + 1),
        );
    } catch {
      return [];
    }
  });

const check = process.argv.includes('--check');
const files = renderSampleMedia();
const stale = Object.entries(files).filter(
  ([path, text]) => current(path) !== text,
);
const orphans = committed().filter(path => !(path in files));

if (check) {
  if (stale.length > 0 || orphans.length > 0) {
    console.error(
      `sample-media: stale or orphaned pictures:\n  ${[...stale.map(([path]) => path), ...orphans].join('\n  ')}\n\n` +
        'Run `pnpm nx run @r10c/sample-media:generate`.',
    );
    process.exit(1);
  }
  console.log(
    `sample-media: ${String(Object.keys(files).length)} pictures are current.`,
  );
} else {
  for (const [path, text] of stale) {
    mkdirSync(dirname(join(REPO_ROOT, path)), { recursive: true });
    writeFileSync(join(REPO_ROOT, path), text);
  }
  for (const path of orphans) rmSync(join(REPO_ROOT, path));
  console.log(
    `sample-media: wrote ${String(stale.length)}, removed ${String(orphans.length)}.`,
  );
}
