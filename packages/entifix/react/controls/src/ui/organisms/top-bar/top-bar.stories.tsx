import type { Meta, StoryObj } from '@storybook/react-vite';

import { Menu } from '../../molecules/menu';
import { TopBar } from './top-bar';

const meta = {
  title: 'Organisms/TopBar',
  component: TopBar,
  tags: ['autodocs'],
} satisfies Meta<typeof TopBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <TopBar>
      <TopBar.Brand>◈ r10c</TopBar.Brand>
      <TopBar.Context>marketplace-admin</TopBar.Context>
      <TopBar.Actions>
        <Menu>
          <Menu.Trigger>◍ Jordan ▾</Menu.Trigger>
          <Menu.Items>
            <Menu.Item>Preferences</Menu.Item>
            <Menu.Item>Sign out</Menu.Item>
          </Menu.Items>
        </Menu>
      </TopBar.Actions>
    </TopBar>
  ),
};
