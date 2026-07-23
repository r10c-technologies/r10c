import type { Meta, StoryObj } from '@storybook/react-vite';

import { Box } from './box';

const meta = {
  title: 'Layout/Box',
  component: Box,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: { padding: 'm', children: 'A padded, themed container.' },
} satisfies Meta<typeof Box>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Loose: Story = { args: { padding: 'xl' } };
export const Tight: Story = { args: { padding: '2xs' } };
