/**
 * The error codes the fleet actually emits, read out of its own source.
 *
 * A service answers `{ error, code, detail }` and the client renders
 * `t('errors:' + code)`. Nothing else connects the two ends: the runtime path is
 * `useErrorMessage` → `useTranslateKey`, and `useTranslateKey` is an explicit
 * escape hatch whose cast discards the i18next module augmentation. So a code
 * with no catalog entry compiles clean, passes `tools/check-i18n.mjs` (which
 * only diffs `es` against `en`) and fails in front of a user, as the literal
 * string `noActiveOrganization`.
 *
 * This module is the missing half: scan for emissions, and let the spec next to
 * it assert every one of them has a sentence.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');

/** The roots that hold shipped source. `tools/` emits nothing to a browser. */
const SOURCE_ROOTS = ['apps', 'packages'];

/**
 * A string literal argument, in any of the three quote styles, with escapes.
 * Written once because both matchers need to skip over one to reach the code.
 */
const STRING = String.raw`'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|\`(?:[^\`\\]|\\.)*\``;

/**
 * `{ error: 'no active organization', code: 'noActiveOrganization' }` — the HTTP
 * body a route answers with.
 *
 * The **pair** is matched, never a bare `code:`. A lone `code` property is a
 * perfectly ordinary member elsewhere in this repo — ADR 0014's dictionary terms
 * have one, and so do several entities — and matching it would fill the scan
 * with vocabulary that has no business in an error catalog.
 *
 * `\s` spans newlines because Prettier breaks these literals across lines the
 * moment the message grows, and the optional `\w+\s*\?\?` arm catches
 * `code: code ?? 'invalidCredentials'`, which is how `respondAuthError` supplies
 * a default for an error that carried none.
 */
const BODY_LITERAL = new RegExp(
  String.raw`\berror\s*:\s*(?:${STRING})\s*,\s*code\s*:\s*(?:\w+\s*\?\?\s*)?'([A-Za-z][\w-]*)'`,
  'g',
);

/**
 * `new UnauthenticatedError('the state is spent', 'invalidState')` — the domain
 * half, where the code is the second positional argument of a `CodedAuthnError`
 * subclass (`packages/business/ts/authn/src/errors/authn-error.ts`). These never
 * appear as a `code:` property at all; `respondAuthError` lifts them onto one on
 * the way out, which is why a scan for the body shape alone would miss them.
 */
const CODED_ERROR = new RegExp(
  String.raw`new\s+(?:UnauthenticatedError|AuthnError|ForbiddenError)\s*\(\s*(?:${STRING})\s*,\s*'([A-Za-z][\w-]*)'`,
  'g',
);

/** Every error code a single source file emits, in order of appearance. */
export const emittedCodes = (source: string): string[] => [
  ...[...source.matchAll(BODY_LITERAL)].map(match => match[1] as string),
  ...[...source.matchAll(CODED_ERROR)].map(match => match[1] as string),
];

const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  'dist',
  'out-tsc',
  '.next',
  'test-output',
]);

/** Every `.ts` file under a root, minus specs — a spec asserts a code, it does
 * not emit one, and treating its assertions as emissions would let a catalog
 * entry be justified by the test that checks for it. */
const sourceFiles = (directory: string, into: string[] = []): string[] => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) sourceFiles(path, into);
    } else if (
      entry.name.endsWith('.ts') &&
      !entry.name.endsWith('.spec.ts') &&
      !entry.name.endsWith('.d.ts')
    ) {
      into.push(path);
    }
  }
  return into;
};

export interface Emission {
  /** The code as it goes on the wire. */
  readonly code: string;
  /** Repo-relative path of the file that emits it. */
  readonly file: string;
}

/** Every emission in the repository, sorted by file then code. */
export const emissions = (): Emission[] => {
  const found: Emission[] = [];

  for (const root of SOURCE_ROOTS) {
    const absolute = join(REPO_ROOT, root);
    if (!statSync(absolute).isDirectory()) continue;

    for (const file of sourceFiles(absolute)) {
      const relative = file.slice(REPO_ROOT.length + 1);
      for (const code of emittedCodes(readFileSync(file, 'utf8'))) {
        found.push({ code, file: relative });
      }
    }
  }

  return found.sort((a, b) =>
    a.file === b.file
      ? a.code.localeCompare(b.code)
      : a.file.localeCompare(b.file),
  );
};
