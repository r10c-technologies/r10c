import playwright from 'eslint-plugin-playwright';

import baseConfig from '../../eslint.config.mjs';

export default [
  playwright.configs['flat/recommended'],
  ...baseConfig,
  {
    files: ['**/*.ts', '**/*.js'],
    // The specs' un-sessioned test object is `baseTest` from
    // `@r10c/entifix-ts-testing-e2e`, not `@playwright/test` — it carries the
    // reused-dev-server guard. The plugin recognises a test block by its import
    // source, so it has to be told, or every `expect` inside one reads as
    // standalone.
    settings: { playwright: { globalAliases: { test: ['base'] } } },
    rules: {},
  },
  {
    ignores: ['**/out-tsc/**'],
  },
];
