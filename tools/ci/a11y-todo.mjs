#!/usr/bin/env node
/**
 * Fails when an entry in an accessibility ratchet list names an issue that is
 * already closed.
 *
 * A Storybook `a11y-todo.json` and a screen `a11y-baseline.json` both accept a
 * known violation on the promise that the named issue removes it (ADR 0075). Once
 * that issue closes the promise is spent: either the fix landed and the entry
 * is stale, or the issue closed without it and the entry is now permanent
 * debt. Both want a person, so this runs outside `Done` — on a schedule, and
 * whenever an issue closes — rather than failing pull requests that did
 * neither.
 *
 *   node tools/ci/a11y-todo.mjs apps/storefront-storybook/a11y-todo.json apps/*-e2e/src/a11y-baseline.json
 *
 * Reads issue state through `gh`, which needs `GH_TOKEN` in CI.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** The entries whose issue `stateOf` reports closed, as `title → issue`. */
export const closedEntries = (todo, stateOf) =>
  Object.entries(todo).filter(([, issue]) => stateOf(issue) === 'CLOSED');

/** `owner/repo#N` → `OPEN` | `CLOSED`, asked of GitHub once per issue. */
export const githubState = () => {
  const seen = new Map();
  return issue => {
    if (!seen.has(issue)) {
      const [repo, number] = issue.split('#');
      const state = execFileSync(
        'gh',
        [
          'issue',
          'view',
          number,
          '-R',
          repo,
          '--json',
          'state',
          '-q',
          '.state',
        ],
        { encoding: 'utf8' },
      ).trim();
      seen.set(issue, state);
    }
    return seen.get(issue);
  };
};

if (import.meta.main) {
  const stateOf = githubState();
  let failed = false;
  for (const file of process.argv.slice(2)) {
    for (const [title, issue] of closedEntries(
      JSON.parse(readFileSync(file, 'utf8')),
      stateOf,
    )) {
      failed = true;
      console.error(
        `${file}: "${title}" is listed against ${issue}, which is closed. ` +
          'Remove the entry if the violation is gone, or name the issue that now owns it.',
      );
    }
  }
  process.exit(failed ? 1 : 0);
}
