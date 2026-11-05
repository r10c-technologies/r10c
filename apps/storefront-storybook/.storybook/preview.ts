import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './preview.css';

import { withThemeByDataAttribute } from '@storybook/addon-themes';
import type { Preview } from '@storybook/react-vite';

import todo from '../a11y-todo.json' with { type: 'json' };

/**
 * The WCAG 2.2 AA rule tags axe runs, and nothing else (ADR 0075). `wcag21a`
 * is in the list because the A-level 2.1 criteria are part of AA conformance.
 */
const WCAG_22_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/**
 * The cell the Vitest project renders in, set by `vitest.storybook.config.mts`;
 * absent in `storybook dev`, where the toolbar chooses.
 */
const CELL = import.meta.env['STORYBOOK_A11Y_CELL'] as
  { theme: string } | undefined;

/** Story titles with a known violation, each owned by the issue that fixes it. */
const TODO: Readonly<Record<string, string>> = todo;

const preview: Preview = {
  parameters: {
    controls: {
      matchers: { color: /(background|color)$/i, date: /Date$/i },
    },
    layout: 'centered',
    backgrounds: { disable: true },
    a11y: {
      // A violation fails the story — in `test-a11y`, and in the panel. Over
      // the whole document, because overlays portal outside the root.
      test: 'error',
      options: { runOnly: { type: 'tag', values: WCAG_22_AA } },
      config: {
        rules: [
          // Headless UI's focus sentinels take focus only to hand it back to
          // the trap they guard (entifix ADR 0024's one exception).
          {
            id: 'aria-hidden-focus',
            selector:
              '[aria-hidden="true"]:not([id^="headlessui-focus-sentinel"])',
          },
        ],
      },
    },
  },
  // A story that renders nothing passes every other check vacuously, which is
  // how the decorator bug once blanked these stories while the build was green.
  afterEach: ({ canvasElement, title, name }) => {
    if (!canvasElement.hasChildNodes()) {
      throw new Error(`${title} › ${name} rendered nothing into its root.`);
    }
  },
  // A listed title still renders and is still audited; its violations are
  // reported instead of failing it, until its issue lands and removes it.
  beforeEach: ({ title, parameters }) => {
    if (TODO[title] !== undefined) {
      parameters['a11y'] = { ...parameters['a11y'], test: 'todo' };
    }
  },
  ...(CELL === undefined ? {} : { initialGlobals: { theme: CELL.theme } }),
  decorators: [
    // The storefront's own palettes, flipped the way the app sets them.
    withThemeByDataAttribute({
      themes: {
        Marketplace: 'marketplace',
        'Marketplace dark': 'marketplace-dark',
      },
      defaultTheme: 'Marketplace',
      attributeName: 'data-theme',
    }),
  ],
};

export default preview;
