import type { Meta, StoryObj } from '@storybook/react-vite';

import { SortControl } from './sort-control.js';

const meta = {
  title: 'Storefront/Sort control',
  component: SortControl,
  tags: ['autodocs'],
  args: {
    label: 'Ordenar por',
    options: [
      { value: 'name', label: 'Nombre' },
      { value: 'price-asc', label: 'Precio: menor a mayor' },
      { value: 'price-desc', label: 'Precio: mayor a menor' },
      { value: 'newest', label: 'Más recientes' },
    ],
    hrefFor: value => `#sort=${value}`,
  },
} satisfies Meta<typeof SortControl>;

export default meta;
type Story = StoryObj<typeof meta>;

/** No order chosen: the default applies and nothing is marked. */
export const Default: Story = {};

export const PriceAscending: Story = { args: { current: 'price-asc' } };
