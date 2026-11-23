/**
 * A resolution hook for running `generate.ts` under plain `node`.
 *
 * The libraries' `dist` keeps their sources' bundler-style specifiers
 * (`export * from './values'`), which every app reaches through webpack and
 * vitest, and which Node refuses: a directory import or a specifier with no
 * extension. A relative specifier that does not resolve as written is retried
 * as `<specifier>.js`, then `<specifier>/index.js`; anything that resolves is
 * left alone, so this can never shadow a real file.
 */
import { existsSync, statSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

const isFile = url => {
  const path = fileURLToPath(url);
  return existsSync(path) && statSync(path).isFile();
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL !== undefined) {
      const target = new URL(specifier, context.parentURL);
      if (!isFile(target)) {
        for (const candidate of [`${specifier}.js`, `${specifier}/index.js`]) {
          if (isFile(new URL(candidate, context.parentURL))) {
            return nextResolve(candidate, context);
          }
        }
      }
    }
    return nextResolve(specifier, context);
  },
});
