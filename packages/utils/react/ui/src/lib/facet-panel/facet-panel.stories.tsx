import type { Meta, StoryObj } from '@storybook/react-vite';

import { FacetPanel } from './facet-panel.js';

const meta = {
  title: 'Storefront/Facet panel',
  component: FacetPanel,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
  args: {
    label: 'Filtrar',
    facets: [
      {
        kind: 'checkbox',
        id: 'brand',
        label: 'Marca',
        options: [
          { label: 'Aurora', href: '#brand=aurora', selected: true, count: 4 },
          {
            label: 'Cobalto',
            href: '#brand=cobalto',
            selected: false,
            count: 6,
          },
          { label: 'Terra', href: '#brand=terra', selected: false, count: 7 },
        ],
      },
      {
        kind: 'checkbox',
        id: 'seller',
        label: 'Vendedor',
        options: [
          { label: 'Casa Solano', href: '#seller=solano', selected: false },
          { label: 'Cobalto Studio', href: '#seller=cobalto', selected: false },
        ],
      },
      {
        kind: 'range',
        id: 'price',
        label: 'Precio',
        action: '#',
        min: { name: 'min', label: 'Mínimo', value: '10' },
        max: { name: 'max', label: 'Máximo' },
        hidden: [['brand', 'brand-aurora']],
        submitLabel: 'Aplicar',
      },
      {
        kind: 'toggle',
        id: 'available',
        label: 'Solo disponibles',
        href: '#available=1',
        selected: false,
      },
    ],
  },
} satisfies Meta<typeof FacetPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Counts on the brands, none on the sellers: a count is optional. */
export const Default: Story = {};

/**
 * Folded away below `sm` behind "Filtrar (1)", open from `sm` up with no
 * summary. Narrow the canvas below 640px to see it fold.
 */
export const Collapsible: Story = {
  args: { collapsible: { summary: 'Filtrar (1)' } },
};

export const Empty: Story = { args: { facets: [] } };
