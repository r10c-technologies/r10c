/**
 * The accessibility lint, proved against a planted violation.
 *
 * `accessibleJsx` is spread by each rendering project after its React or Next
 * preset, which ships a warn-level subset of the same rules: a project that
 * drops the spread, or moves it above the preset, goes on linting clean with
 * the rules at `warn` (ADR 0075). So this lints a clickable `<div>` through
 * each project's own configuration — the one Nx lints it with — at a path in
 * its source, and requires both keyboard rules at error. A keyboard-reachable
 * `<button>` beside it must raise neither, so a configuration that errors on
 * everything cannot pass.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');

const RULES = [
  'jsx-a11y/click-events-have-key-events',
  'jsx-a11y/no-static-element-interactions',
];

const errorsAt = async (project: string, code: string) => {
  const eslint = new ESLint({ cwd: join(REPO_ROOT, project) });
  const [result] = await eslint.lintText(code, {
    filePath: join(REPO_ROOT, project, 'src/planted.tsx'),
  });
  return (result?.messages ?? [])
    .filter(message => message.severity === 2)
    .map(message => message.ruleId)
    .filter(rule => rule !== null && RULES.includes(rule));
};

describe('a click target is reachable by keyboard', () => {
  it.each([
    ['the back office', 'apps/back-office-app'],
    ['the storefront', 'apps/marketplace-app'],
    ['a domain shell', 'packages/shells/next/marketplace-admin'],
    ['the shared React ui', 'packages/utils/react/ui'],
    ['the storefront stories', 'apps/storefront-storybook'],
  ])(
    'is required in %s',
    async (_label, project) => {
      expect(
        await errorsAt(
          project,
          'export const X = () => <div onClick={() => undefined}>x</div>;\n',
        ),
      ).toEqual(RULES);
      expect(
        await errorsAt(
          project,
          'export const X = () => <button type="button" onClick={() => undefined}>x</button>;\n',
        ),
      ).toEqual([]);
    },
    60_000,
  );
});

/**
 * The ratchet lists (ADR 0075): a Storybook `a11y-todo.json` maps a story
 * title, and a screen `a11y-baseline.json` a fingerprint, to the issue that
 * removes it. An entry is accepted debt only while it names one, and a todo
 * title only while its story exists.
 */
const ISSUE = /^[\w.-]+\/[\w.-]+#\d+$/;

const tracked = (...patterns: string[]) =>
  execFileSync('git', ['ls-files', ...patterns], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(path => path !== '');

const entries = (path: string): [string, string][] =>
  Object.entries(
    JSON.parse(readFileSync(join(REPO_ROOT, path), 'utf8')) as Record<
      string,
      string
    >,
  );

describe('every accessibility ratchet entry', () => {
  it.each(tracked('*a11y-todo.json', '*a11y-baseline.json'))(
    'in %s names the issue that removes it',
    path => {
      expect(
        entries(path)
          // A baseline's `$fingerprints` names its scheme, not an owner.
          .filter(([key]) => !key.startsWith('$'))
          .filter(([, owner]) => !ISSUE.test(owner))
          .map(([key]) => key),
      ).toEqual([]);
    },
  );

  it.each(tracked('*a11y-todo.json'))(
    'in %s names a story that exists',
    path => {
      const titles = new Set(
        tracked('*.stories.tsx').flatMap(story => {
          const title = /title: '([^']+)'/.exec(
            readFileSync(join(REPO_ROOT, story), 'utf8'),
          )?.[1];
          return title === undefined ? [] : [title];
        }),
      );
      expect(
        entries(path)
          .map(([title]) => title)
          .filter(title => !titles.has(title)),
      ).toEqual([]);
    },
  );
});
