import type { Meta, StoryObj } from '@storybook/react-vite';

import { Center } from './center';

const meta = {
  title: 'Layout/Center',
  component: Center,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  render: args => (
    <Center {...args}>
      <p className="text-content">
        This column is centered horizontally and capped to a readable measure so
        lines never grow uncomfortably long. Resize the viewport to see it hold
        its maximum width while staying centered.
      </p>
    </Center>
  ),
} satisfies Meta<typeof Center>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { gutters: true } };
export const NarrowMeasure: Story = {
  args: { gutters: true, measure: '40ch' },
};
