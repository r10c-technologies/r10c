import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './preview.css';

import { withThemeByDataAttribute } from '@storybook/addon-themes';
import type { Preview } from '@storybook/react-vite';

const preview: Preview = {
  parameters: {
    controls: {
      matchers: { color: /(background|color)$/i, date: /Date$/i },
    },
    layout: 'centered',
    backgrounds: { disable: true },
  },
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
