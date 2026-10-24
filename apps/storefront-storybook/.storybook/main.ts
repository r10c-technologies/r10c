import type { StorybookConfig } from '@storybook/react-vite';

/**
 * The storefront's Storybook: the generic controls in `@r10c/utils-react-ui`,
 * plus this host's own stories, which render them over the shared catalog
 * fixtures.
 *
 * It lives in its own project rather than in the UI package. The package is
 * `layer:utils` and may not import an entity, while the fixtures are entities
 * by construction. A host with no layer may import both, and that is the
 * "composition" a binding needs.
 *
 * ⚠️ Workspace packages resolve to their **built `dist`**, not to source.
 * entifix's own Storybook can use its source condition because its stories
 * never reach an entity file through Vite's transform. Here the fixtures do,
 * and Vite 8's transform leaves stage-3 decorators in place, so the bundle
 * carried a raw `@entity()` the browser cannot parse. It built green and
 * rendered nothing. swc lowers the decorators when it builds each library, so
 * `build-storybook` depends on `^build`, and `storybook` is run beside
 * `watch-libs` for edits to show.
 *
 * Stories are in no tsconfig project, so `build-storybook` is the only check
 * that compiles them, which is why CI runs it.
 */
const config: StorybookConfig = {
  stories: [
    '../src/**/*.mdx',
    '../src/**/*.stories.@(ts|tsx)',
    '../../../packages/utils/react/ui/src/**/*.stories.@(ts|tsx)',
  ],
  addons: ['@storybook/addon-docs', '@storybook/addon-themes'],
  framework: { name: '@storybook/react-vite', options: {} },
  core: { disableTelemetry: true },
};

export default config;
