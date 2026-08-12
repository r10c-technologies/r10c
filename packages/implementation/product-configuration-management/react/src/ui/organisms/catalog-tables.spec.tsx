import {
  ProductBrand,
  ProductCategory,
} from '@r10c/business-ts-catalog-reference';
import { ProductSpecification } from '@r10c/business-ts-product-configuration-management';
import { EntifixQueryProvider } from '@r10c/entifix-react-integration';
import {
  ConfigurationRepositoryTag,
  EntityRepositoryTag,
  loadUCFactory,
} from '@r10c/entifix-ts-business';
import type { Entity } from '@r10c/entifix-ts-core';
import {
  makeInMemoryEntityRepository,
  makeStubConfigurationClient,
} from '@r10c/entifix-ts-testing-unit';
import { render as rtlRender, screen, waitFor } from '@testing-library/react';
import { Context } from 'effect';
import type { ReactElement } from 'react';
import { describe, expect, it } from 'vitest';

import { ProductBrandTable } from './product-brand-table/product-brand-table.js';
import { ProductCategoryTable } from './product-category-table/product-category-table.js';
import { ProductTable } from './product-table/product-table.js';

/** The tables run `useDataLoading`, which needs a QueryClient in scope. */
const render = (ui: ReactElement) =>
  rtlRender(<EntifixQueryProvider>{ui}</EntifixQueryProvider>);

const makeBrand = (id: string, name: string) => {
  const brand = new ProductBrand(name);
  brand.id = id;
  return brand;
};

const makeCategory = (id: string, name: string) => {
  const category = new ProductCategory(id.toUpperCase(), name);
  category.id = id;
  return category;
};

const contextFor = (items: Entity[]) =>
  Context.make(EntityRepositoryTag, makeInMemoryEntityRepository(items)).pipe(
    Context.add(ConfigurationRepositoryTag, makeStubConfigurationClient()),
  );

// These wrappers are thin on purpose: their whole job is to bind an entity to
// `EntityTable` and run the load use-case, so the tests assert that a page
// really appears rather than re-testing the table.
describe('ProductBrandTable', () => {
  it('lists what the use-case loaded', async () => {
    render(
      <ProductBrandTable
        uc={loadUCFactory<ProductBrand>()}
        ctx={contextFor([makeBrand('b-1', 'Acme')])}
        hrefFor={id => `/catalog/product-brand/${String(id)}`}
        newHref="/catalog/product-brand/new"
      />,
    );

    await waitFor(() =>
      expect(screen.getAllByText('Acme').length).toBeGreaterThan(0),
    );
    expect(screen.getByRole('link', { name: 'Nuevo' })).toBeInTheDocument();
  });
});

describe('ProductCategoryTable', () => {
  it('lists what the use-case loaded', async () => {
    render(
      <ProductCategoryTable
        uc={loadUCFactory<ProductCategory>()}
        ctx={contextFor([makeCategory('c-1', 'Tools')])}
        hrefFor={id => `/catalog/product-category/${String(id)}`}
        newHref="/catalog/product-category/new"
      />,
    );

    await waitFor(() =>
      expect(screen.getAllByText('Tools').length).toBeGreaterThan(0),
    );
  });
});

describe('ProductTable', () => {
  const makeProduct = (brandId?: string) => {
    const product = new ProductSpecification('P-1', 'Widget');
    product.id = 'p-1';
    product.brandId = brandId;
    product.categoryId = 'product-category-1';
    return product;
  };

  const renderTable = (product: ProductSpecification) =>
    render(
      <ProductTable
        uc={loadUCFactory<ProductSpecification>()}
        ctx={contextFor([product])}
        hrefFor={id => `/catalog/product/${String(id)}`}
        newHref="/catalog/product/new"
      />,
    );

  it('lists what the use-case loaded', async () => {
    renderTable(makeProduct('product-brand-1'));

    await waitFor(() =>
      expect(screen.getAllByText('Widget').length).toBeGreaterThan(0),
    );
  });

  it('renders the brand id through its column override', async () => {
    renderTable(makeProduct('product-brand-1'));

    await waitFor(() =>
      expect(screen.getAllByText('product-brand-1').length).toBeGreaterThan(0),
    );
  });

  it('renders a placeholder when the specification is unclassified', async () => {
    // A missing classification is a display gap, never a broken record — the
    // reference crosses a store boundary and no foreign key enforces it.
    renderTable(makeProduct(undefined));

    await waitFor(() =>
      expect(screen.getAllByText('—').length).toBeGreaterThan(0),
    );
  });
});
