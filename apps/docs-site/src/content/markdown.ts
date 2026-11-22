import type { SiteLocale } from './copy';

/**
 * A page's address inside one locale's tree, with the trailing slash every
 * exported page has (`trailingSlash: true`), so a link never answers with a
 * redirect from a static host.
 */
export const href = (locale: SiteLocale, ...slugs: readonly string[]) =>
  `/${[locale, ...slugs].join('/')}/`;

/** A value set in code: an id, a permission, a store name. */
export const code = (value: string) => `\`${value.replaceAll('`', "'")}\``;

export const link = (text: string, to: string) =>
  `[${text.replaceAll(/[[\]]/g, '')}](${to})`;

const cell = (value: string) =>
  value.replaceAll('|', '\\|').replaceAll('\n', ' ');

/**
 * A two-column table of facts: the label, then what the register says. The
 * first fact is the header row, since GFM has no table without one.
 */
export const facts = (rows: readonly (readonly [string, string])[]) =>
  table(rows[0] ?? ['', ''], rows.slice(1));

/** A table with a header row. */
export const table = (
  header: readonly string[],
  rows: readonly (readonly string[])[],
) =>
  [
    `| ${header.map(cell).join(' | ')} |`,
    `| ${header.map(() => '---').join(' | ')} |`,
    ...rows.map(row => `| ${row.map(cell).join(' | ')} |`),
  ].join('\n');

/** A list, or the given words when there is nothing to list. */
export const list = (items: readonly string[], empty: string) =>
  items.length === 0 ? empty : items.join(', ');

export const section = (title: string, body: string) =>
  `## ${title}\n\n${body}`;

export const page = (...blocks: readonly string[]) =>
  `${blocks.filter(block => block !== '').join('\n\n')}\n`;
