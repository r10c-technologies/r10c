/**
 * The set of documents these checks hold, and the small readers they share.
 *
 * The split that shapes this project: some documentation facts have a
 * machine-readable source and are **generated** (`tools/sync-docs.mjs` owns the
 * port table, the store register and the ADR index). Everything else is prose a
 * person wrote, and the only thing a machine can do about prose is assert that
 * the identifiers inside it still exist. That is what lives here.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');
export const DOCS_ROOT = join(REPO_ROOT, 'docs');
export const ADR_ROOT = join(DOCS_ROOT, 'adr');
export const SHARED_ROOT = join(DOCS_ROOT, '_shared');

export const read = (...parts: string[]): string =>
  readFileSync(join(REPO_ROOT, ...parts), 'utf8');

/** `docs/*.md`, the six deep docs. Not `_shared`, not `adr`. */
export const deepDocs = (): string[] =>
  readdirSync(DOCS_ROOT, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(entry => entry.name)
    .sort();

/** `docs/adr/NNNN-*.md`, sorted. Excludes the README. */
export const adrFiles = (): string[] =>
  readdirSync(ADR_ROOT)
    .filter(file => /^\d{4}-.*\.md$/.test(file))
    .sort();

/** Every markdown file these checks read, as repo-relative paths. */
export const allDocs = (): string[] => [
  'README.md',
  'CLAUDE.md',
  ...deepDocs().map(name => join('docs', name)),
  ...readdirSync(SHARED_ROOT)
    .filter(f => f.endsWith('.md'))
    .map(name => join('docs', '_shared', name)),
  join('docs', 'adr', 'README.md'),
  ...adrFiles().map(name => join('docs', 'adr', name)),
];

export interface AdrRecord {
  readonly file: string;
  /** The four-digit number, as written: `0004`. */
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly text: string;
  /**
   * ADR ids this record records as having revised or amended it, read from the
   * `- Revised: … by [ADR NNNN]` / `- Amended by: [ADR NNNN]` header lines.
   */
  readonly revisedBy: readonly string[];
}

/**
 * Every ADR id named by a `- Revised:` / `- Amended by:` header entry.
 *
 * Two things make this more than one regex. A header entry **wraps**: Prettier
 * reflows it, so the list item spans several lines and the ADR reference is
 * often not on the first one. And a single entry may name **several** records —
 * ADR 0006's cites 0022 and 0023 in one breath — so matching once per line
 * would silently drop the second and report a symmetric supersession as one-way.
 */
const revisionMarkers = (text: string): string[] => {
  const found: string[] = [];
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    if (!/^- (?:Revised:|Amended by:)/.test(lines[i])) continue;
    // Consume the entry's continuation lines (indented, or blank-terminated).
    let entry = lines[i];
    for (let j = i + 1; j < lines.length && /^\s+\S/.test(lines[j]); j++) {
      entry += ` ${lines[j]}`;
    }
    for (const match of entry.matchAll(/\[ADR (\d{4})\]/g)) {
      found.push(match[1]);
    }
  }
  return found;
};

export const adrs = (): AdrRecord[] =>
  adrFiles().map(file => {
    const text = readFileSync(join(ADR_ROOT, file), 'utf8');
    const title = text.match(/^# \d+\.\s*(.+)$/m);
    const status = text.match(/^- Status:\s*(\w+)/m);
    if (!title || !status) {
      throw new Error(`${file}: expected an "# NN. Title" H1 and "- Status:"`);
    }
    return {
      file,
      id: file.slice(0, 4),
      title: title[1].trim(),
      status: status[1],
      text,
      revisedBy: [...new Set(revisionMarkers(text))],
    };
  });

/**
 * Strip fenced and inline code so link-shaped text inside an example is not
 * read as a link. `docs/adr/README.md` documents the header line as
 * `- Revised: <date> by [ADR 00XX](00XX-….md)` inside a fence — a template,
 * not a link to a file that should exist.
 */
export const withoutCode = (text: string): string =>
  text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');

export interface DocLink {
  /** Repo-relative or document-relative path. Empty for a same-document anchor. */
  readonly target: string;
  readonly hash: string;
}

/**
 * Markdown link targets that point somewhere inside this repo.
 *
 * Skips external URLs and `mailto:`. A bare `#anchor` is kept with an empty
 * `target`, meaning "this document".
 */
export const localLinks = (text: string): DocLink[] =>
  [...withoutCode(text).matchAll(/\]\(([^)\s]*?)(?:#([^)\s]*))?\)/g)]
    .map(m => ({ target: m[1] ?? '', hash: m[2] ?? '' }))
    .filter(
      ({ target, hash }) =>
        (target || hash) &&
        !/^[a-z][a-z0-9+.-]*:/i.test(target) &&
        !target.startsWith('//'),
    );

/**
 * GitHub's heading→anchor slug.
 *
 * Note the last step maps **each** space to a hyphen rather than collapsing
 * runs. That is not a detail: stripping `+` out of "Auth: sessions + tokens"
 * leaves two adjacent spaces, so the real anchor is `auth-sessions--tokens`
 * with a double hyphen, and a collapsing slugger reports every such link broken.
 */
export const slug = (heading: string): string =>
  heading
    .trim()
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[^\w\s-]/g, '')
    .replace(/ /g, '-');

export const headingSlugs = (text: string): Set<string> =>
  new Set(
    [...text.matchAll(/^#{1,6}\s+(.+)$/gm)]
      .map(m => slug(m[1]))
      .filter(Boolean),
  );
