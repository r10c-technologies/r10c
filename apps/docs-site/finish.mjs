// What `next build` leaves unfinished in `out/`, in order:
//
// 1. Storybook beside the site, at `/ui/` (#658): the storefront's components,
//    built by `@r10c/storefront-storybook:build-storybook` and copied, not
//    rebuilt, so the site serves exactly what that target's gate checked.
// 2. The Pagefind index, over the pages only: Storybook's HTML carries no
//    `data-pagefind-body`, so it is never indexed.
// 3. Every internal link and asset an exported page names must resolve to a
//    file in `out/`, or the build fails. No network: a static host serves
//    files, so a file that is missing is a link that is broken.
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';

const HERE = import.meta.dirname;
const OUT = join(HERE, 'out');
const STORYBOOK = join(HERE, '../storefront-storybook/storybook-static');

if (!existsSync(join(STORYBOOK, 'index.html'))) {
  console.error(
    `docs-site: no Storybook build at ${relative(HERE, STORYBOOK)}`,
  );
  process.exit(1);
}
cpSync(STORYBOOK, join(OUT, 'ui'), { recursive: true });

const pagefind = spawnSync(
  'pagefind',
  ['--site', 'out', '--output-subdir', 'pagefind'],
  { cwd: HERE, stdio: 'inherit', shell: process.platform === 'win32' },
);
if (pagefind.status !== 0) {
  console.error(
    `docs-site: pagefind failed${pagefind.error ? ` (${pagefind.error.message}) — run through \`pnpm nx build\`, which puts it on the PATH` : ''}`,
  );
  process.exit(pagefind.status ?? 1);
}

const htmlFiles = directory =>
  readdirSync(directory).flatMap(name => {
    const path = join(directory, name);
    if (statSync(path).isDirectory())
      return name === 'ui' && directory === OUT ? [] : htmlFiles(path);
    return name.endsWith('.html') ? [path] : [];
  });

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;
const ATTRIBUTE = /\s(?:href|src)="([^"]*)"/g;

/** Where a link lands in `out/`, or `undefined` when no file serves it. */
const target = (from, link) => {
  const path = decodeURIComponent(link.split(/[?#]/)[0]);
  if (path === '') return from;
  const file = path.startsWith('/')
    ? join(OUT, path)
    : join(dirname(from), path);
  if (existsSync(file) && statSync(file).isDirectory()) {
    const index = join(file, 'index.html');
    return existsSync(index) ? index : undefined;
  }
  return existsSync(file) ? file : undefined;
};

const broken = htmlFiles(OUT).flatMap(file =>
  [...readFileSync(file, 'utf8').matchAll(ATTRIBUTE)]
    .map(([, link]) => link.replaceAll('&amp;', '&'))
    .filter(link => !EXTERNAL.test(link) && target(file, link) === undefined)
    .map(link => `${relative(OUT, file)} → ${link}`),
);

if (broken.length > 0) {
  console.error(
    `docs-site: ${broken.length} broken link(s)\n${[...new Set(broken)].join('\n')}`,
  );
  process.exit(1);
}
console.log('docs-site: every internal link resolves');
