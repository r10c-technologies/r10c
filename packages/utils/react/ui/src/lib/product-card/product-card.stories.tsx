import { Grid, StatusTag } from '@entifix/react-controls/primitives';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { ProductCard } from './product-card.js';

/**
 * Literal props only: this package sits in the utils layer and cannot import
 * an entity, so these stories show the roles. The host's own stories show
 * the card over the shared fixtures.
 */
const meta = {
  title: 'Storefront/Product card',
  component: ProductCard,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  decorators: [
    Story => (
      <div style={{ maxWidth: '20rem' }}>
        <Story />
      </div>
    ),
  ],
  args: {
    title: 'Aurora Desk Lamp',
    brand: 'Aurora',
    description: 'Warm dimmable LED with a brushed aluminium arm.',
    price: { amount: 1999, currency: 'GTQ', locale: 'es-GT' },
    availability: { label: 'Disponible', available: true },
    media: {
      url: 'https://picsum.photos/seed/aurora-desk-lamp/800/800',
      alt: 'Aurora Desk Lamp, arm raised',
    },
    cta: (
      <a className="text-primary underline" href="#product">
        Ver producto
      </a>
    ),
  },
} satisfies Meta<typeof ProductCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Every role filled, the two nothing fills yet included, to show where they sit. */
export const EveryRole: Story = {
  args: {
    unitPrice: 'Q2.00 / unidad',
    rating: <span>★★★★☆ 4,1</span>,
    badges: <StatusTag tone="info">Nuevo</StatusTag>,
    chips: (
      <>
        <StatusTag tone="neutral">LED</StatusTag>
        <StatusTag tone="neutral">Regulable</StatusTag>
      </>
    ),
  },
};

export const LongTitle: Story = {
  args: {
    title:
      'Aurora Articulated Desk Lamp with Warm Dimmable LED, Brushed Aluminium Arm and Weighted Base',
  },
};

/** No picture: the box keeps its size, so the grid does not jump. */
export const NoMedia: Story = { args: { media: undefined } };

/** No brand and no description: nothing is left where they would be. */
export const NoBrand: Story = {
  args: { brand: undefined, description: undefined },
};

export const OutOfStock: Story = {
  args: { availability: { label: 'Agotado', available: false } },
};

export const Compact: Story = { args: { density: 'compact' } };

/** The states side by side, the way a results grid mixes them. */
export const InAGrid: Story = {
  decorators: [
    Story => (
      <div style={{ width: '60rem' }}>
        <Story />
      </div>
    ),
  ],
  render: args => (
    <Grid min="14rem" gap="l">
      <ProductCard {...args} />
      <ProductCard {...args} media={undefined} />
      <ProductCard {...args} brand={undefined} description={undefined} />
      <ProductCard
        {...args}
        {...LongTitle.args}
        availability={{ label: 'Agotado', available: false }}
      />
    </Grid>
  ),
};
