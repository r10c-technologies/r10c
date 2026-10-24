import { Cluster } from '@entifix/react-controls/primitives';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { Badge, Chip } from './badge.js';

const meta = {
  title: 'Storefront/Badges and chips',
  component: Badge,
  tags: ['autodocs'],
  args: { children: 'Nuevo' },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Neutral: Story = {};

export const EveryTone: Story = {
  render: () => (
    <Cluster gap="2xs">
      <Badge>Nuevo</Badge>
      <Badge tone="accent">Oferta</Badge>
      <Badge tone="success">Disponible</Badge>
      <Badge tone="danger">Agotado</Badge>
    </Cluster>
  ),
};

export const Chips: Story = {
  render: () => (
    <Cluster gap="3xs">
      <Chip>LED</Chip>
      <Chip>Regulable</Chip>
      <Chip href="#brand-aurora">Aurora</Chip>
    </Cluster>
  ),
};
