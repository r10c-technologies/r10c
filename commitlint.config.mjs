import {
  findAttribution,
  formatAttributionFindings,
} from './tools/conventions/attribution.mjs';

/**
 * ESM rather than the `.js` this used to be, because the attribution predicate
 * is an ES module shared with `@r10c/conventions` and a CommonJS config cannot
 * import one without a top-level `await` it is not allowed to have. commitlint
 * 21 resolves `commitlint.config.mjs` natively, and the CommonJS presets below
 * import fine through interop.
 *
 * This is the repository's first `rules` entry. Everything the conventional and
 * Nx-scope presets check is shaped around the subject line — type, scope, case,
 * length — so nothing here has ever looked at the body or its trailers, which
 * is exactly where AI attribution lands.
 */
export default {
  extends: ['@commitlint/config-conventional', '@commitlint/config-nx-scopes'],

  // A local plugin: the rule is one function over the raw message and has no
  // reason to be a published package.
  plugins: [
    {
      rules: {
        'no-ai-attribution': ({ raw }) => {
          const findings = findAttribution(raw ?? '');
          return [
            findings.length === 0,
            formatAttributionFindings(findings, 'This commit message'),
          ];
        },
      },
    },
  ],

  rules: {
    // Level 2 — an error, so the commit is refused rather than annotated.
    'no-ai-attribution': [2, 'always'],
  },
};
