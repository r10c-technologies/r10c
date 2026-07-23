import type { Meta, StoryObj } from '@storybook/react-vite';

import { DemoBox } from '../_demo';
import { Cover } from './cover';

const meta = {
  title: 'Layout/Cover',
  component: Cover,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  render: args => (
    <Cover
      {...args}
      minHeight="22rem"
      className="rounded-md border border-border p-s"
    >
      <Cover.Header>
        <DemoBox tone="surface">Header</DemoBox>
      </Cover.Header>
      <Cover.Main>
        <DemoBox>Centered principal content</DemoBox>
      </Cover.Main>
      <Cover.Footer>
        <DemoBox tone="surface">Footer</DemoBox>
      </Cover.Footer>
    </Cover>
  ),
} satisfies Meta<typeof Cover>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
