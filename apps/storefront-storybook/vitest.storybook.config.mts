import * as path from 'node:path';

import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import {
  defineConfig,
  type TestProjectInlineConfiguration,
} from 'vitest/config';

const root = import.meta.dirname;

/**
 * The storefront's two palettes, each at the fluid scale it ships with. The
 * storefront has no density mode, so a cell is a palette and nothing else.
 */
const CELLS = {
  'marketplace-fluid': { theme: 'Marketplace' },
  'marketplace-dark-fluid': { theme: 'Marketplace dark' },
} as const;

const cell = (name: keyof typeof CELLS): TestProjectInlineConfiguration => ({
  extends: true,
  plugins: [storybookTest({ configDir: path.join(root, '.storybook') })],
  // Read by `.storybook/preview.ts` as its `initialGlobals`.
  define: {
    'import.meta.env.STORYBOOK_A11Y_CELL': JSON.stringify(CELLS[name]),
  },
  test: {
    name,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
  },
});

/**
 * Every storefront story, rendered in Chromium through `@storybook/addon-vitest`
 * and audited by `@storybook/addon-a11y` against WCAG 2.2 AA, once per palette
 * (ADR 0075, entifix 0024). A story that throws, renders nothing, or raises a
 * violation fails the run, unless its title is on `a11y-todo.json` with the
 * issue that removes it.
 */
export default defineConfig({
  root,
  cacheDir: path.join(root, '../../node_modules/.vite/storefront-storybook'),
  test: {
    watch: false,
    reporters: [
      'default',
      [
        path.join(root, '.storybook/a11y-todo-reporter.ts'),
        { cells: Object.keys(CELLS) },
      ],
    ],
    projects: (Object.keys(CELLS) as (keyof typeof CELLS)[]).map(cell),
  },
});
