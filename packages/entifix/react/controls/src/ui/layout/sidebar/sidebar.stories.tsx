import type { Meta, StoryObj } from '@storybook/react-vite';

import { DemoBox } from '../_demo';
import { Sidebar } from './sidebar';

const meta = {
  title: 'Layout/Sidebar',
  component: Sidebar,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  render: args => (
    <Sidebar {...args}>
      <Sidebar.Side width="16rem">
        <DemoBox>Side · 16rem</DemoBox>
      </Sidebar.Side>
      <Sidebar.Main>
        <DemoBox tone="surface">
          Fluid main — keeps a 50% minimum, then wraps below the side.
        </DemoBox>
      </Sidebar.Main>
    </Sidebar>
  ),
} satisfies Meta<typeof Sidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const SideOnEnd: Story = { args: { side: 'end' } };
