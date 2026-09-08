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

/**
 * `readonly code = OFFERING_HAS_NO_PRICE;` — the domain half for a
 * `Data.TaggedError`, which carries its code as a class member.
 *
 * ⚠️ **This is the shape the two matchers above cannot see, and missing it was
 * not theoretical.** A route catches such a failure and answers
 * `{ error: '…', code: failure.code }` — a *member expression*, so
 * `BODY_LITERAL` does not match it, and the class is not one of the three
 * `CodedAuthnError` subclasses `CODED_ERROR` names. Measured while writing
 * ADR 0049: `illegalOfferingTransition` and `offeringHasNoPrice` were emitted by
 * a live route, cataloged by hand, and invisible to this scan — so the gate that
 * exists to stop a raw code reaching a user was not watching them.
 *
 * The identifier is resolved against the file's own `export const` declarations
 * ({@link declaredCodes}) rather than followed across modules: every such class
 * in this repository declares its code beside itself, and a cross-file resolver
 * would be a module graph this scan deliberately does not build.
 */
const TAGGED_ERROR_CODE = new RegExp(
  String.raw`\breadonly\s+code\s*=\s*([A-Za-z_$][\w$]*)\s*;`,
  'g',
);

/**
 * `export const OFFERING_HAS_NO_PRICE = 'offeringHasNoPrice';` — the literals a
 * {@link TAGGED_ERROR_CODE} identifier can name.
 *
 * `export`ed only, on purpose. A code a route can spell is one the domain
 * published; a file-private constant assigned to `readonly code` would be
 * unreachable from the guard that renders it.
 */
const EXPORTED_CODE = new RegExp(
  String.raw`\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*(?::\s*string\s*)?=\s*'([A-Za-z][\w-]*)'`,
  'g',
);

/** The `export const NAME = 'literal'` pairs one file declares. */
const declaredCodes = (source: string): Map<string, string> =>
  new Map(
    [...source.matchAll(EXPORTED_CODE)].map(match => [
      match[1] as string,
      match[2] as string,
    ]),
  );

/** Every error code a single source file emits, in order of appearance. */
export const emittedCodes = (source: string): string[] => {
  const declared = declaredCodes(source);

  return [
    ...[...source.matchAll(BODY_LITERAL)].map(match => match[1] as string),
    ...[...source.matchAll(CODED_ERROR)].map(match => match[1] as string),
    ...[...source.matchAll(TAGGED_ERROR_CODE)]
      .map(match => declared.get(match[1] as string))
      .filter((code): code is string => code !== undefined),
  ];
};

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
