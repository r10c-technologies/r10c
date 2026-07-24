import type { Meta, StoryObj } from '@storybook/react-vite';

import { Tab, TabAddButton, TabStrip } from './tab-strip';

const meta = {
  title: 'Molecules/TabStrip',
  component: TabStrip,
  tags: ['autodocs'],
} satisfies Meta<typeof TabStrip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Workspace: Story = {
  render: () => (
    <TabStrip>
      <Tab label="Products" active />
      <Tab label="Brands" />
      <Tab label="Acme #123" state="dirty" />
      <Tab label="Widget #7" state="saving" />
      <Tab label="Import" state="error" />
      <TabAddButton />
    </TabStrip>
  ),
};
