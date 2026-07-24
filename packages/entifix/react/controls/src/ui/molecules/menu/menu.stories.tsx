import type { Meta, StoryObj } from '@storybook/react-vite';

import { Menu } from './menu';

const meta = {
  title: 'Molecules/Menu',
  component: Menu,
  tags: ['autodocs'],
} satisfies Meta<typeof Menu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const UserMenu: Story = {
  args: { children: null },
  render: () => (
    <Menu>
      <Menu.Trigger>◍ Jordan ▾</Menu.Trigger>
      <Menu.Items>
        <Menu.Item>Profile</Menu.Item>
        <Menu.Item>Preferences</Menu.Item>
        <Menu.Item>Sign out</Menu.Item>
      </Menu.Items>
    </Menu>
  ),
};
