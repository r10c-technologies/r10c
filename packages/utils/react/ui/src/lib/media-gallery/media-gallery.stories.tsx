import type { Meta, StoryObj } from '@storybook/react-vite';

import { MediaGallery } from './media-gallery.js';

const picture = (seed: string, alt: string) => ({
  url: `https://picsum.photos/seed/${seed}/800/800`,
  alt,
});

const meta = {
  title: 'Storefront/Media gallery',
  component: MediaGallery,
  tags: ['autodocs'],
  decorators: [
    Story => (
      <div style={{ width: '28rem' }}>
        <Story />
      </div>
    ),
  ],
  args: {
    label: 'Imágenes del producto',
    items: [
      picture('cobalto-arc-lamp', 'Cobalto Arc Lamp over a sofa'),
      picture('cobalto-arc-lamp-2', 'Cobalto Arc Lamp, marble foot'),
      picture('cobalto-arc-lamp-3', 'Cobalto Arc Lamp, shade detail'),
    ],
  },
} satisfies Meta<typeof MediaGallery>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Three pictures: follow a thumbnail, or swipe the strip. */
export const Several: Story = {};

/** One picture: no thumbnails. */
export const Single: Story = {
  args: { items: [picture('aurora-desk-lamp', 'Aurora Desk Lamp')] },
};

/** No pictures: the gallery renders nothing, and the page decides. */
export const None: Story = { args: { items: [] } };
