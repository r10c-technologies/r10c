import type { Meta, StoryObj } from '@storybook/react-vite';

import { PriceBlock } from './price-block.js';

const meta = {
  title: 'Storefront/Price block',
  component: PriceBlock,
  tags: ['autodocs'],
  args: { locale: 'es-GT', price: { amount: 1999, currency: 'GTQ' } },
} satisfies Meta<typeof PriceBlock>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Quetzales: Story = {};

export const Dollars: Story = {
  args: { price: { amount: 18900, currency: 'USD' } },
};

export const English: Story = { args: { locale: 'en' } };

/** Declared and not filled yet: the snapshot has no unit to price by. */
export const WithUnitPrice: Story = {
  args: { unitPrice: { amount: 499, currency: 'GTQ', per: 'kg' } },
};

/** A code `Intl` rejects still renders, as the amount and the code. */
export const UnknownCurrency: Story = {
  args: { price: { amount: 1999, currency: 'XXQ' } },
};
