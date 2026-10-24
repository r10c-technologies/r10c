import type { EntityRepository } from '@entifix/business';
import type { Entity } from '@entifix/core';
import type {
  ProductBrand,
  ProductCategory,
} from '@r10c/business-ts-catalog-reference';
import type { PublishedVendor } from '@r10c/business-ts-marketplace-vendor';
import {
  offeringFacets,
  parseSearch,
} from '@r10c/implementation-marketplace-catalog-next';
import { catalogFixtures } from '@r10c/testing-catalog-fixtures';
import { FacetPanel } from '@r10c/utils-react-ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { Effect } from 'effect';

/**
 * The facet panel as the storefront derives it: the cell's `offeringFacets`
 * over the fixtures' vocabulary, with the search address as a story arg. Every
 * link is the address the storefront would navigate to.
 */
const fixtures = catalogFixtures();

const everything = <T extends Entity>(repository: EntityRepository) =>
  Effect.runSync(repository.load<T>({ page: 1, pageSize: 100 })).items;

const active = <T extends { status?: string }>(items: readonly T[]) =>
  items.filter(item => item.status !== 'retired');

const choices = {
  category: everything<ProductCategory>(fixtures.categories)
    .filter(category => category.status === 'active' && !category.parentId)
    .map(category => ({ id: String(category.id), name: category.name })),
  brand: active(everything<ProductBrand>(fixtures.brands)).map(brand => ({
    id: String(brand.id),
    name: brand.name,
  })),
  seller: everything<PublishedVendor>(fixtures.vendors).map(vendor => ({
    id: vendor.vendorId,
    name: vendor.displayName,
  })),
};

function Facets({ query }: { readonly query: string }) {
  return (
    <div style={{ width: '18rem' }}>
      <FacetPanel
        label="Filtrar"
        facets={offeringFacets({
          path: '/es/search',
          state: parseSearch(new URLSearchParams(query)),
          choices,
          labels: {
            category: 'Categoría',
            brand: 'Marca',
            seller: 'Vendedor',
            price: 'Precio',
            available: 'Solo disponibles',
            min: 'Desde',
            max: 'Hasta',
            apply: 'Aplicar',
          },
        })}
      />
    </div>
  );
}

const meta = {
  title: 'Storefront/Facets',
  component: Facets,
  parameters: { layout: 'padded' },
  args: { query: '' },
} satisfies Meta<typeof Facets>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Nothing chosen: every value is a link that adds it. */
export const NoSearch: Story = {};

/** A search in force: the chosen values are marked, and the range is filled in. */
export const Narrowed: Story = {
  args: {
    query:
      'q=l&brand=brand-aurora&seller=vendor-casa-solano&min=100&available=1',
  },
};
