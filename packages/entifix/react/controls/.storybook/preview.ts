import './preview.css';

import { type Locale, LOCALES } from '@r10c/entifix-ts-i18n';
import { withThemeByDataAttribute } from '@storybook/addon-themes';
import type { Preview } from '@storybook/react-vite';
import { createElement } from 'react';

import { I18nProvider } from '../src/i18n';

const preview: Preview = {
  parameters: {
    controls: {
      matchers: { color: /(background|color)$/i, date: /Date$/i },
    },
    layout: 'centered',
    backgrounds: { disable: true },
  },
  initialGlobals: {
    locale: 'es',
  },
  globalTypes: {
    locale: {
      description: 'Locale',
      toolbar: {
        icon: 'globe',
        items: [...LOCALES],
        dynamicTitle: true,
      },
    },
  },
  decorators: [
    // Every control resolves its copy through the provider, so a story without
    // one would exercise the fallback rather than the real path. The toolbar
    // puts the second locale one click away — which is where a caption that
    // outgrew its button gets noticed.
    (Story, context) =>
      createElement(
        I18nProvider,
        { locale: context.globals['locale'] as Locale },
        createElement(Story),
      ),
    // Flip the `data-theme` attribute on <html> from the toolbar, exactly how
    // apps switch palettes. Values match the shipped presets.
    withThemeByDataAttribute({
      themes: { Aurora: 'aurora', Sunset: 'sunset', Midnight: 'midnight' },
      defaultTheme: 'Aurora',
      attributeName: 'data-theme',
    }),
  ],
};

export default preview;
