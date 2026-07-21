import {
  Product,
  ProductBrand,
  ProductCategory,
} from '@r10c/business-ts-product-configuration-management';
import {
  ConfigurationRepositoryTag,
  EntityLinkResolverTag,
  EntityRepositoryTag,
  loadUCFactory,
} from '@r10c/entifix-ts-business';
import type { Entity } from '@r10c/entifix-ts-core';
import {
  makeInMemoryEntityLinkResolver,
  makeInMemoryEntityRepository,
  makeStubConfigurationStore,
} from '@r10c/entifix-ts-testing-unit';
import { render, screen, waitFor } from '@testing-library/react';
import { Context } from 'effect';
import { describe, expect, it } from 'vitest';

import { ProductBrandTable } from './product-brand-table/product-brand-table.js';
import { ProductCategoryTable } from './product-category-table/product-category-table.js';
import { ProductTable } from './product-table/product-table.js';

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
    Context.add(ConfigurationRepositoryTag, makeStubConfigurationStore()),
    Context.add(
      EntityLinkResolverTag,
      makeInMemoryEntityLinkResolver([
        [ProductBrand, [makeBrand('b-1', 'Acme')]],
        [ProductCategory, [makeCategory('c-1', 'Tools')]],
      ]),
    ),
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
        hrefFor={(id) => `/catalog/product-brand/${String(id)}`}
        newHref="/catalog/product-brand/new"
      />,
    );

    await waitFor(() =>
      expect(screen.getAllByText('Acme').length).toBeGreaterThan(0),
    );
    expect(screen.getByRole('link', { name: 'New' })).toBeInTheDocument();
  });
});

describe('ProductCategoryTable', () => {
  it('lists what the use-case loaded', async () => {
    render(
      <ProductCategoryTable
        uc={loadUCFactory<ProductCategory>()}
        ctx={contextFor([makeCategory('c-1', 'Tools')])}
        hrefFor={(id) => `/catalog/product-category/${String(id)}`}
        newHref="/catalog/product-category/new"
      />,
    );

    await waitFor(() =>
      expect(screen.getAllByText('Tools').length).toBeGreaterThan(0),
    );
  });
});

describe('ProductTable', () => {
  const makeProduct = (embedded: boolean) => {
    const product = new Product('P-1', 'Widget');
    product.id = 'p-1';
    if (embedded) {
      product.brand.setValue(makeBrand('b-1', 'Acme'));
    } else {
      product.brand.setId('b-9');
    }
    product.category.setId('c-1');
    return product;
  };

  const renderTable = (product: Product) =>
    render(
      <ProductTable
        uc={loadUCFactory<Product>()}
        ctx={contextFor([product])}
        hrefFor={(id) => `/catalog/product/${String(id)}`}
        newHref="/catalog/product/new"
      />,
    );

  it('lists what the use-case loaded', async () => {
    renderTable(makeProduct(true));

    await waitFor(() =>
      expect(screen.getAllByText('Widget').length).toBeGreaterThan(0),
    );
  });

  // `brand` carries an `<EntityColumn>` override — the escape hatch for a
  // column whose presentation the metadata cannot express.
  it('renders the brand through its column override', async () => {
    renderTable(makeProduct(true));

    await waitFor(() => expect(screen.getAllByText('Acme').length).toBe(2));
  });

  it('falls back to the brand’s foreign key when the target is not loaded', async () => {
    renderTable(makeProduct(false));

    await waitFor(() => expect(screen.getAllByText('b-9').length).toBe(2));
  });

  // A product with no brand at all still has to render a cell, not a blank.
  it('renders a placeholder when the product has no brand', async () => {
    const product = new Product('P-1', 'Widget');
    product.id = 'p-1';
    product.category.setId('c-1');

    renderTable(product);

    await waitFor(() => expect(screen.getAllByText('—').length).toBeGreaterThan(0));
  });
});
