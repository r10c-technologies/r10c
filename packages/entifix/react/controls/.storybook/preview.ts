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
