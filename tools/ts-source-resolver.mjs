/**
 * A module-resolution hook that lets plain `node` import this repo's TypeScript
 * sources directly.
 *
 * Node 26 strips types on its own, but it does **not** rewrite specifiers, and
 * every project here is a TS solution build: `registry.ts` imports
 * `./slices/auth.slice.js`, which is the file `tsc` will emit and not a file that
 * exists in the source tree. Without this hook, importing the register from a
 * script fails with `Cannot find module .../auth.slice.js`.
 *
 * Rewriting only happens when the `.js` genuinely does not exist, so a real
 * compiled artifact still wins and this can never shadow `dist`.
 *
 * `registerHooks` rather than `register`: the latter is deprecated in Node 26
 * (DEP0205) and runs the hook on a separate loader thread, which this does not
 * need — the rewrite is a synchronous `existsSync`.
 *
 * Import it before the code that needs it (`import './ts-source-resolver.mjs'`),
 * or pass `node --import ./tools/ts-source-resolver.mjs <script>`.
 */
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith('.') || !specifier.endsWith('.js')) {
      return nextResolve(specifier, context);
    }
    const asTs = new URL(specifier, context.parentURL).href.replace(
      /\.js$/,
      '.ts',
    );
    return existsSync(fileURLToPath(asTs))
      ? nextResolve(asTs, context)
      : nextResolve(specifier, context);
  },
});
