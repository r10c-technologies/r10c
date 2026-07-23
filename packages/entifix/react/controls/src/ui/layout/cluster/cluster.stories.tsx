import type { Meta, StoryObj } from '@storybook/react-vite';

import { DemoBox } from '../_demo';
import { Cluster } from './cluster';

const meta = {
  title: 'Layout/Cluster',
  component: Cluster,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  render: args => (
    <Cluster {...args}>
      {['Filters', 'Sort', 'Export', 'New', 'Archive', 'Settings'].map(l => (
        <DemoBox key={l}>{l}</DemoBox>
      ))}
    </Cluster>
  ),
} satisfies Meta<typeof Cluster>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { gap: 's' } };
export const SpaceBetween: Story = { args: { gap: 's', justify: 'between' } };
