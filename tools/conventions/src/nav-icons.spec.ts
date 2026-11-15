/**
 * The sidebar draws every destination from one monochrome glyph set.
 *
 * A colour emoji beside a line glyph is a consistency break on every screen
 * (heuristic H4), and it is easy to reintroduce: `⚖`, `⏱` and `⚙` look like
 * glyphs in an editor and render as emoji on macOS. So the rule is checked
 * rather than stated (ADR 0046): no icon a shell or the host declares may hold
 * an `Extended_Pictographic` code point or the U+FE0F variation selector that
 * asks for emoji presentation.
 *
 * Icons are declared as `icon: '…'` on a surface or a nav item, or as the
 * values of an `*_ICONS` record (the auth shell's account items). Comments are
 * not read: a `⚠️` in prose is not a sidebar icon.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');

/** What makes a glyph render as a colour pictograph. */
const PICTOGRAPHIC = /\p{Extended_Pictographic}|\u{FE0F}/u;

/** Every icon a source file declares, comments stripped first. */
export const declaredIcons = (source: string): string[] => {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const inline = [...code.matchAll(/\bicon:\s*'([^']*)'/g)].map(m => m[1]);
  const records = [
    ...code.matchAll(/_ICONS\b[^=]*=\s*\{([\s\S]*?)\}/g),
  ].flatMap(m => [...m[1].matchAll(/:\s*'([^']*)'/g)].map(v => v[1]));
  return [...inline, ...records];
};

/** The icons in `source` that would render as a colour pictograph. */
export const pictographicIcons = (source: string): string[] =>
  declaredIcons(source).filter(icon => PICTOGRAPHIC.test(icon));

const navSources = (): string[] => {
  const shells = join(REPO_ROOT, 'packages/shells/next');
  const files = readdirSync(shells).flatMap(shell => {
    const src = join(shells, shell, 'src');
    return readdirSync(src)
      .filter(
        name =>
          (name.endsWith('-surfaces.ts') || name === 'nav.ts') &&
          !name.endsWith('.spec.ts'),
      )
      .map(name => join(src, name));
  });
  return [...files, join(REPO_ROOT, 'apps/back-office-app/src/lib/nav.ts')];
};

describe('Sidebar icons', () => {
  it('finds the icons it is meant to check', () => {
    // A walk that reads nothing passes vacuously, so the count is pinned to a
    // floor: every back-office destination declares one.
    const icons = navSources().flatMap(file =>
      declaredIcons(readFileSync(file, 'utf8')),
    );
    expect(icons.length).toBeGreaterThanOrEqual(20);
  });

  it('draws every one from the monochrome set', () => {
    const offenders = navSources().flatMap(file =>
      pictographicIcons(readFileSync(file, 'utf8')).map(
        icon => `${relative(REPO_ROOT, file)}: ${icon}`,
      ),
    );
    expect(
      offenders,
      'these sidebar icons render as colour emoji; pick a glyph from the ' +
        'monochrome set the rest of the sidebar uses:\n  ' +
        offenders.join('\n  '),
    ).toEqual([]);
  });

  it('catches a planted emoji, a text-presentation pictograph and a selector', () => {
    expect(pictographicIcons("const s = { icon: '📦' };")).toEqual(['📦']);
    expect(pictographicIcons("const s = { icon: '⚖' };")).toEqual(['⚖']);
    expect(pictographicIcons("const s = { icon: '◉\u{FE0F}' };")).toHaveLength(
      1,
    );
    expect(
      pictographicIcons("const A_ICONS = { 'a.b': '⏱', 'a.c': '◎' };"),
    ).toEqual(['⏱']);
  });

  it('ignores prose and a monochrome glyph', () => {
    expect(
      pictographicIcons("// ⚠️ icon: '📦'\nconst s = { icon: '⊡' };"),
    ).toEqual([]);
  });
});
