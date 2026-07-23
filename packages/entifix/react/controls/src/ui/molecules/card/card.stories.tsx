import type { Meta, StoryObj } from '@storybook/react-vite';

import { Card } from './card';

const meta = {
  title: 'Molecules/Card',
  component: Card,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    children: 'An elevated surface with a themed border and fluid padding.',
  },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
