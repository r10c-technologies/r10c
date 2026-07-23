import type { StorybookConfig } from '@storybook/react-vite';

/**
 * Storybook for the agnostic design-system components. It reproduces the app
 * runtime so stories render exactly like production:
 *  - the Tailwind v4 CSS-first pipeline (see `preview.css` + `postcss.config.cjs`),
 *  - the `@r10c/source` resolution condition so workspace packages resolve to
 *    their TypeScript `src` (a single `MetaEntity` registry, no prior build).
 *
 * Stories cover only presentational components — none instantiate decorated
 * entities — so the default React-Vite transform suffices (no SWC decorator
 * pass needed here, unlike the Vitest config).
 */
const config: StorybookConfig = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-docs', '@storybook/addon-themes'],
  framework: { name: '@storybook/react-vite', options: {} },
  core: { disableTelemetry: true },
  viteFinal: viteConfig => {
    viteConfig.resolve ??= {};
    viteConfig.resolve.conditions = [
      '@r10c/source',
      ...(viteConfig.resolve.conditions ?? [
        'browser',
        'module',
        'import',
        'default',
      ]),
    ];
    return viteConfig;
  },
};

export default config;
