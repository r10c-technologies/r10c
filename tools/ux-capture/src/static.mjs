// The source half of #566's numbers (Batch 0, 2026-11-14): raw colours,
// inline styles and off-scale values in r10c's own UI source. A colour, a
// spacing or a layer belongs to a token (ADR 0027); each hit is listed with
// its line so a reviewer can tell a real one from a false positive.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../../../', import.meta.url).pathname;

/**
 * Where r10c's own screens are written — app sources, Next shells and the
 * react/next cells — the scope Batch 0 measured, so the numbers compare.
 */
const ROOTS = [
  'apps/marketplace-app/src',
  'apps/back-office-app/src',
  'packages/shells/next',
];
const CELL_ROOT = 'packages/implementation';

const SKIP = /(?:^|\/)(?:node_modules|dist|out-tsc|\.next|test-output)(?:\/|$)/;

const walk = dir =>
  readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (SKIP.test(path)) return [];
    if (statSync(path).isDirectory()) return walk(path);
    return /\.tsx$/.test(name) && !/\.(spec|stories)\.tsx$/.test(name)
      ? [path]
      : [];
  });

const cells = readdirSync(join(ROOT, CELL_ROOT)).flatMap(key =>
  ['react', 'next']
    .map(tech => join(ROOT, CELL_ROOT, key, tech, 'src'))
    .filter(path => {
      try {
        return statSync(path).isDirectory();
      } catch {
        return false;
      }
    }),
);

const files = [...ROOTS.map(root => join(ROOT, root)), ...cells].flatMap(walk);

/** A colour written as a value rather than a token. */
const RAW_COLOUR =
  /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab)\(|\b(?:bg|text|border|fill|stroke|ring|outline)-(?:white|black|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3})\b/;

/** A `style` prop: layout and colour belong to classes and tokens. */
const INLINE_STYLE = /\bstyle=\{/;

/**
 * A value off the token scales, as Batch 0 counted it: Tailwind's numeric
 * spacing and layering steps, and any arbitrary `[…]` value. The Utopia steps
 * (`gap-s`, `p-m`) are the spacing scale; Tailwind's sizing steps (`size-6`,
 * `min-h-11`) are a sizing scale of their own and not counted.
 */
const OFF_SCALE =
  /(?<![\w-])(?:-?(?:[mp][trblxyse]?|gap(?:-[xy])?|space-[xy]|inset(?:-[xy])?|top|right|bottom|left|z)-(?:[1-9]\d*(?:\.\d+)?|0\.\d+|\[[^\]\s]+\])|\w+-\[[^\]\s]+\])(?![\w-])/;

/**
 * A file with its comments blanked and its lines kept, so a `#527` issue
 * reference or a class named in prose is not counted.
 */
const codeOf = file =>
  readFileSync(file, 'utf8').replace(
    /\/\*[\s\S]*?\*\/|(?<![:'"`])\/\/[^\n]*/g,
    comment => comment.replace(/[^\n]/g, ' '),
  );

const scan = pattern =>
  files.flatMap(file =>
    codeOf(file)
      .split('\n')
      .flatMap((line, index) =>
        pattern.test(line)
          ? [`${relative(ROOT, file)}:${String(index + 1)}: ${line.trim()}`]
          : [],
      ),
  );

const report = {
  files: files.length,
  rawColours: scan(RAW_COLOUR),
  inlineStyles: scan(INLINE_STYLE),
  offScale: scan(OFF_SCALE),
};

const RULES = { rawColours: 0, inlineStyles: 0, offScale: 5 };

console.log(`UI source files scanned: ${String(report.files)}`);
let failed = false;
for (const [key, limit] of Object.entries(RULES)) {
  const hits = report[key];
  const ok = hits.length <= limit;
  failed ||= !ok;
  console.log(
    `${ok ? '✓' : '✗'} ${key}: ${String(hits.length)} (rule ≤ ${String(limit)})`,
  );
  for (const hit of hits) console.log(`    ${hit}`);
}
process.exitCode = failed ? 1 : 0;
