import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The enforceable half of the loading contract (issue #108, adopted in #139).
 *
 * A lint rule for "this control supports a skeleton" is not writable — the
 * shape of a placeholder is not something ESLint can see. What *is* checkable
 * is that every control which can be in a loading state demonstrates that state
 * in Storybook, where a reviewer and the theme/locale toolbars can actually look
 * at it.
 *
 * **What counts as a control with a loading state**, precisely, because the
 * question is otherwise ambiguous: a component whose own props type declares an
 * `isLoading` member. That deliberately includes `EntityTable`, `EntityForm` and
 * `LoadingBoundary`, and deliberately excludes `EntityLinkInput` and
 * `EntityLinkPicker` — those two take no such prop, they read
 * `source.quick.isLoading` / `source.browse.isLoading` off the `EntityLinkSource`
 * port and (for the picker) hand it to `EntityTable`, so the state they show is
 * the table's. Widening the rule to "mentions isLoading anywhere" would sweep in
 * every consumer and make the gate meaningless.
 */
const UI_ROOT = join(import.meta.dirname);

/** Every file under `dir`, recursively, skipping build output. */
const sourceFiles = (dir: string): string[] => {
  const skip = new Set(['node_modules', 'dist', 'out-tsc', 'test-output']);
  const walk = (current: string): string[] =>
    readdirSync(current, { withFileTypes: true }).flatMap(entry => {
      if (skip.has(entry.name)) return [];
      const full = join(current, entry.name);
      if (entry.isDirectory()) return walk(full);
      return entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')
        ? [full]
        : [];
    });
  return walk(dir);
};

/** `isLoading` declared as a member of an interface, not read off something. */
const DECLARES_IS_LOADING = /^\s*isLoading\??:\s*boolean/m;

/**
 * Controls that declare a loading state, as `<directory, componentName>`. A
 * props type may live in `<name>.types.ts` beside the component, so the story is
 * looked for by directory rather than beside the declaring file.
 */
const controlsWithLoadingState = (): string[] =>
  [
    ...new Set(
      sourceFiles(UI_ROOT)
        .filter(
          file =>
            !file.endsWith('.spec.ts') &&
            !file.endsWith('.spec.tsx') &&
            !file.endsWith('.stories.tsx') &&
            DECLARES_IS_LOADING.test(readFileSync(file, 'utf8')),
        )
        .map(file => join(file, '..')),
    ),
  ].sort();

const hasLoadingStory = (directory: string): boolean =>
  readdirSync(directory)
    .filter(name => name.endsWith('.stories.tsx'))
    .some(name =>
      /^export const Loading[:\s]/m.test(
        readFileSync(join(directory, name), 'utf8'),
      ),
    );

describe('the loading contract — every control with a loading state shows it', () => {
  // A regex that silently stopped matching would make the assertion below pass
  // while checking nothing at all. Pin the count so that failure is loud.
  it('finds the controls it is meant to check', () => {
    const names = controlsWithLoadingState().map(
      directory => directory.split('/').pop() ?? '',
    );

    expect(names).toContain('entity-table');
    expect(names).toContain('entity-form');
    expect(names).toContain('loading-boundary');
    expect(names.length).toBeGreaterThanOrEqual(3);
  });

  it('gives each of them a Loading story', () => {
    const missing = controlsWithLoadingState().filter(
      directory => !hasLoadingStory(directory),
    );

    expect(
      missing,
      `these controls declare \`isLoading\` but ship no \`Loading\` story:\n  ${missing.join('\n  ')}\n` +
        "Add `export const Loading: Story = { … }` to the control's " +
        '`*.stories.tsx`, showing the placeholder it renders while loading.',
    ).toEqual([]);
  });
});
