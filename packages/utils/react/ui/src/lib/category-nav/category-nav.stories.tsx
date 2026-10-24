import type { Meta, StoryObj } from '@storybook/react-vite';

import { CategoryNav } from './category-nav.js';

const meta = {
  title: 'Storefront/Category nav',
  component: CategoryNav,
  tags: ['autodocs'],
  args: {
    label: 'Subcategorías',
    items: [
      { label: 'Ceiling Lights', href: '#ceiling-lights' },
      { label: 'Desk Lamps', href: '#desk-lamps' },
    ],
  },
} satisfies Meta<typeof CategoryNav>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A category's children. */
export const Children: Story = {};

export const WithCurrent: Story = {
  args: {
    items: [
      { label: 'Lighting', href: '#lighting', current: true },
      { label: 'Tableware', href: '#tableware' },
      { label: 'Textiles', href: '#textiles' },
    ],
  },
};
