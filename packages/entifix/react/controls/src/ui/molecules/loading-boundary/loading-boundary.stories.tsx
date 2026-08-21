import type { Meta, StoryObj } from '@storybook/react-vite';

import { LoadingBoundary } from './loading-boundary';

const meta = {
  title: 'Molecules/LoadingBoundary',
  component: LoadingBoundary,
  tags: ['autodocs'],
} satisfies Meta<typeof LoadingBoundary>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {
  args: { isLoading: true, lines: 3, children: <p>Loaded content</p> },
};

export const Loaded: Story = {
  args: { isLoading: false, children: <p>Loaded content</p> },
};

/** `lines={0}` stands in for a single control rather than a paragraph. */
export const SingleBlock: Story = {
  args: { isLoading: true, lines: 0, children: <p>Loaded content</p> },
};

export const WithCustomFallback: Story = {
  args: {
    isLoading: true,
    fallback: <p className="text-content-muted">Fetching affordances…</p>,
    children: <p>Loaded content</p>,
  },
};
