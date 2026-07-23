import type { Meta, StoryObj } from '@storybook/react-vite';

import { Card } from '../card';
import { Stack } from './stack';

const meta = {
  title: 'Molecules/Stack',
  component: Stack,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  render: args => (
    <Stack {...args}>
      <Card>First</Card>
      <Card>Second</Card>
      <Card>Third</Card>
    </Stack>
  ),
} satisfies Meta<typeof Stack>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { gap: 'm' } };
export const Tight: Story = { args: { gap: 'xs' } };
