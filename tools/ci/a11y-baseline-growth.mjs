#!/usr/bin/env node
/**
 * Fails when a committed accessibility baseline gains an entry relative to the
 * merge base.
 *
 * A baseline accepts the violations a screen had when its gate was switched
 * on, each against the issue that removes it (ADR 0075). Its only legitimate
 * direction afterwards is down. `A11Y_BASELINE=update` rewrites one happily,
 * so a pull request that ran it to make a regression pass would otherwise
 * merge with the regression accepted. A baseline that did not exist at the
 * merge base is new, and is the one place entries are added.
 *
 *   node tools/ci/a11y-baseline-growth.mjs <base-sha>
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** Keys of `after` that `before` does not have. */
export const addedEntries = (before, after) =>
  Object.keys(after).filter(key => !(key in before));

const git = (...args) =>
  execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });

/** The file at `ref`, or `undefined` when it did not exist there. */
const atRef = (ref, path) => {
  try {
    return JSON.parse(git('show', `${ref}:${path}`));
  } catch {
    return undefined;
  }
};

if (import.meta.main) {
  const [base] = process.argv.slice(2);
  if (base === undefined) {
    console.error('usage: a11y-baseline-growth.mjs <base-sha>');
    process.exit(2);
  }
  const changed = git('diff', '--name-only', `${base}...HEAD`)
    .split('\n')
    .filter(path => path.endsWith('a11y-baseline.json'));

  let failed = false;
  for (const path of changed) {
    const before = atRef(base, path);
    if (before === undefined) continue;
    let after;
    try {
      after = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      continue; // Deleted: a gate with nothing left to accept.
    }
    for (const entry of addedEntries(before, after)) {
      failed = true;
      console.error(
        `${path}: gained ${entry}. A baseline only shrinks — fix the violation instead.`,
      );
    }
  }
  process.exit(failed ? 1 : 0);
}
