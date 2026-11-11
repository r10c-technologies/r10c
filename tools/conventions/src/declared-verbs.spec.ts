/**
 * A session screen holds no write of its own (#526).
 *
 * The sessions screen and the administrator's sessions panel used to post
 * `sign-out-others`, `revoke-sessions` and a single revoke from hand-written
 * buttons, around the confirmation each verb declares. They now render the
 * declared descriptors and run them through `useVerbInvoker` (ADR 0026), and
 * the transport is `session-verbs.ts`. A `fetch` creeping back into either
 * screen outside a `read*` loader is that bypass returning, so this refuses it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');

const SCREENS = [
  'packages/shells/next/auth/src/client/account-sessions-view.tsx',
  'packages/shells/next/auth/src/client/user-sessions-panel.tsx',
];

/**
 * The top-level declarations in `source` that call `fetch(` and are not a
 * `read*` loader. A declaration runs from a line starting a `const`,
 * `function` or `export` at column 0 to the next one.
 */
export const writesOutsideLoaders = (source: string): string[] => {
  const starts = /^(?:export\s+)?(?:const|(?:async\s+)?function)\s+(\w+)/gm;
  const found = [...source.matchAll(starts)];
  return found.flatMap((match, index) => {
    const body = source.slice(
      match.index,
      found[index + 1]?.index ?? source.length,
    );
    const name = match[1] ?? '';
    return body.includes('fetch(') && !name.startsWith('read') ? [name] : [];
  });
};

describe('a session screen writes only through its declared verbs', () => {
  it.each(SCREENS)('%s fetches only in its read loaders', path => {
    expect(
      writesOutsideLoaders(readFileSync(join(REPO_ROOT, path), 'utf8')),
    ).toEqual([]);
  });

  it('refuses a write planted in a component (planted)', () => {
    const planted = [
      "const readRows = async () => fetch('/api/rows');",
      'export function Screen() {',
      "  const kick = () => fetch('/api/rows', { method: 'DELETE' });",
      '  return null;',
      '}',
    ].join('\n');

    expect(writesOutsideLoaders(planted)).toEqual(['Screen']);
  });
});
