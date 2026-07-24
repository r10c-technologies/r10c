import type { Meta, StoryObj } from '@storybook/react-vite';

import { Skeleton, SkeletonText } from './skeleton';

const meta = {
  title: 'Atoms/Skeleton',
  component: Skeleton,
  tags: ['autodocs'],
} satisfies Meta<typeof Skeleton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Block: Story = { args: { className: 'h-24 w-64' } };
export const Line: Story = { args: { shape: 'line', className: 'w-48' } };
export const Circle: Story = { args: { shape: 'circle', className: 'w-12' } };

export const Paragraph: StoryObj<typeof SkeletonText> = {
  render: () => <SkeletonText lines={4} className="w-80" />,
};
