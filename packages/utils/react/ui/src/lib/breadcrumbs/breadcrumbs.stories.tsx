import type { Meta, StoryObj } from '@storybook/react-vite';

import { Breadcrumbs } from './breadcrumbs.js';

const meta = {
  title: 'Storefront/Breadcrumbs',
  component: Breadcrumbs,
  tags: ['autodocs'],
  args: {
    label: 'Ruta de navegación',
    items: [
      { label: 'Inicio', href: '#home' },
      { label: 'Lighting', href: '#lighting' },
      { label: 'Desk Lamps', href: '#desk-lamps' },
      { label: 'Task Lights' },
    ],
  },
} satisfies Meta<typeof Breadcrumbs>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A category three levels down. */
export const Deep: Story = {};

/** A root category: home and itself. */
export const Root: Story = {
  args: { items: [{ label: 'Inicio', href: '#home' }, { label: 'Lighting' }] },
};
