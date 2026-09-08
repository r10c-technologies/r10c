/**
 * Resolves the extensionless relative imports every module in this workspace
 * uses.
 *
 * Node's ESM resolver requires a file extension; nothing in this repo writes
 * one, because every consumer — webpack, swc, Turbopack, vite — supplies it.
 * The mock preload beside this file is the one place plain Node loads workspace
 * modules directly, so it has to do the same. `.ts` is in the list because
 * `@r10c/entifix-ts-testing-e2e` publishes TypeScript source (it is
 * `type:testing` and has no build target); Node 26 strips the types itself.
 *
 * Deliberately a fallback rather than a rewrite: anything Node can already
 * resolve is left completely alone, so this can only add resolutions, never
 * change one.
 */
const SUFFIXES = ['.js', '/index.js', '.ts', '.tsx', '/index.ts'];

export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (error) {
    if (!specifier.startsWith('.') && !specifier.startsWith('/')) throw error;
    for (const suffix of SUFFIXES) {
      try {
        return await next(specifier + suffix, context);
      } catch {
        /* try the next shape */
      }
    }
    throw error;
  }
}
