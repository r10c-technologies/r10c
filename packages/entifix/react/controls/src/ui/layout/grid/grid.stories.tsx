import type { Meta, StoryObj } from '@storybook/react-vite';

import { DemoBox } from '../_demo';
import { Grid } from './grid';

const meta = {
  title: 'Layout/Grid',
  component: Grid,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  render: args => (
    <Grid {...args}>
      {Array.from({ length: 8 }, (_, i) => (
        <DemoBox key={i} tone="surface">
          Card {i + 1}
        </DemoBox>
      ))}
    </Grid>
  ),
} satisfies Meta<typeof Grid>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WiderColumns: Story = { args: { min: '20rem' } };
