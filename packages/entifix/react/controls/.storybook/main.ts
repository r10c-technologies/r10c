import type { StorybookConfig } from '@storybook/react-vite';

/**
 * Storybook for the agnostic design-system components. It reproduces the app
 * runtime so stories render exactly like production:
 *  - the Tailwind v4 CSS-first pipeline (see `preview.css` + `postcss.config.cjs`),
 *  - the `@r10c/source` resolution condition so workspace packages resolve to
 *    their TypeScript `src` (a single `MetaEntity` registry, no prior build).
 *
 * Stories **do** instantiate decorated entities — `EntityTable`, `EntityForm`
 * and `EntityLinkInput` build themselves from metadata, so there is no way to
 * show them without one. The default React-Vite transform handles the stage-3
 * decorators, and `Symbol.metadata` is polyfilled by `entifix-ts-core` itself on
 * first import, so no SWC pass is needed here (unlike the Vitest config, which
 * runs one for the spec files). `nx build-storybook` runs in CI precisely
 * because that arrangement is load-bearing and nothing else checks it.
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
