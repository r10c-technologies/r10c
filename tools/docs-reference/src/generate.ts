/**
 * Writes what the documentation site reads from the shells it may not import:
 *
 *   pnpm nx run @r10c/docs-reference:generate
 *
 * `out/flow-catalog.json` holds the composed flow scenarios (#687) and
 * `out/openapi/<deployment>.json` each service's OpenAPI document (#654). Both
 * are gitignored and rebuilt by the site's `build` and `dev`, which depend on
 * this target, so the site never draws from a stale copy.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { serviceDocuments } from './openapi.js';
import { flowCatalogDocument } from './scenarios.js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../out');

const write = (path: string, document: unknown) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`);
};

rmSync(OUT, { recursive: true, force: true });
write(join(OUT, 'flow-catalog.json'), await flowCatalogDocument());
for (const { deployment, document } of serviceDocuments()) {
  write(join(OUT, 'openapi', `${deployment}.json`), document);
}
