/**
 * `@r10c/conventions` is a check, not a library — its whole surface is
 * `conventions.spec.ts`, and the predicate it shares with the commit hook lives
 * in `tools/conventions/attribution.mjs` so a hook can load it without a build.
 *
 * The empty export exists because the project needs an entry point to be a
 * workspace package at all; `@r10c/docs-check` carries the same one.
 */
export {};
