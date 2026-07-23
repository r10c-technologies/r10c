import type { Meta, StoryObj } from '@storybook/react-vite';

import { Breadcrumbs } from './breadcrumbs';

const meta = {
  title: 'Molecules/Breadcrumbs',
  component: Breadcrumbs,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    items: [
      { label: 'Home', href: '/' },
      { label: 'Catalog', href: '/catalog' },
      { label: 'Products' },
    ],
  },
} satisfies Meta<typeof Breadcrumbs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const ChevronSeparator: Story = { args: { separator: '›' } };
