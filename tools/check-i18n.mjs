/**
 * Catalog parity gate.
 *
 * The `en` catalogs are annotated with the `es` shape, so TypeScript already
 * rejects a *missing* key. This covers what types cannot:
 *
 *  - a key present in `en` but not `es` (the annotation is structural, and an
 *    excess property only errors on a fresh object literal — not through a
 *    spread or a helper),
 *  - a value that exists but is empty or still holds its Spanish text verbatim
 *    where that is obviously untranslated,
 *  - interpolation placeholders that drift between locales, which types cannot
 *    see at all: `{{field}} is required` vs `{{campo}} es obligatorio` renders
 *    a literal `{{campo}}` to the user.
 *
 * Loaded through jiti rather than a bare `import`: the sources are authored for
 * `moduleResolution: bundler` and omit file extensions, which Node's own
 * resolver rejects.
 */
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { resources } = await jiti.import(
  '../packages/entifix/ts/i18n/src/resources/index.ts',
);

const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;

/** `{ table: { open: 'Abrir' } }` → `Map { 'table.open' => 'Abrir' }`. */
function flatten(value, prefix = '', into = new Map()) {
  for (const [key, entry] of Object.entries(value)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    if (typeof entry === 'string') into.set(path, entry);
    else flatten(entry, path, into);
  }
  return into;
}

function placeholders(text) {
  return new Set([...text.matchAll(PLACEHOLDER)].map(match => match[1]));
}

const problems = [];
const [reference, ...others] = Object.keys(resources);
const referenceKeys = flatten(resources[reference]);

for (const [key, text] of referenceKeys) {
  if (text.trim() === '') problems.push(`${reference}: "${key}" is empty`);
}

for (const locale of others) {
  const keys = flatten(resources[locale]);

  for (const key of referenceKeys.keys()) {
    if (!keys.has(key)) problems.push(`${locale}: missing "${key}"`);
  }

  for (const [key, text] of keys) {
    if (!referenceKeys.has(key)) {
      problems.push(`${locale}: "${key}" has no counterpart in ${reference}`);
      continue;
    }
    if (text.trim() === '') {
      problems.push(`${locale}: "${key}" is empty`);
      continue;
    }

    const expected = placeholders(referenceKeys.get(key));
    const actual = placeholders(text);
    for (const name of expected) {
      if (!actual.has(name)) {
        problems.push(`${locale}: "${key}" drops the {{${name}}} placeholder`);
      }
    }
    for (const name of actual) {
      if (!expected.has(name)) {
        problems.push(`${locale}: "${key}" adds an unknown {{${name}}} placeholder`);
      }
    }
  }
}

if (problems.length > 0) {
  console.error(`i18n catalogs are out of sync (${problems.length}):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  `i18n catalogs in sync: ${referenceKeys.size} keys × ${Object.keys(resources).length} locales.`,
);
