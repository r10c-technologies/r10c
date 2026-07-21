import {
  Product,
  ProductBrand,
  ProductCategory,
} from '@r10c/business-ts-product-configuration-management';
import {
  ConfigurationRepositoryTag,
  EntityRepositoryTag,
} from '@r10c/entifix-ts-business';
import { EntifixConnError, type Entity } from '@r10c/entifix-ts-core';
import {
  makeInMemoryEntityRepository,
  makeStubConfigurationStore,
} from '@r10c/entifix-ts-testing-unit';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Context } from 'effect';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MarketplaceAdminAdapters } from './client-types.js';
import { MarketplaceAdminAdaptersProvider } from './marketplace-admin-context/marketplace-admin-context.js';
import { ProductBrandListClientPage } from './product-brand-list/product-brand-list-client-page.js';
import { ProductBrandSingleViewClientPage } from './product-brand-single-view/product-brand-single-view-client-page.js';
import { ProductCategoryListClientPage } from './product-category-list/product-category-list-client-page.js';
import { ProductCategorySingleViewClientPage } from './product-category-single-view/product-category-single-view-client-page.js';
import { ProductListClientPage } from './product-list/product-list-client-page.js';
import { ProductSingleViewClientPage } from './product-single-view/product-single-view-client-page.js';

// The pages read the route through `next/navigation`, which only exists inside
// a running Next app; the slug is the one input a test needs to vary.
const push = vi.fn();
let slug = 'new';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useParams: () => ({ slug }),
}));

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

const makeProduct = () => {
  const product = new Product('P-1', 'Widget');
  product.id = 'p-1';
  product.brand.setValue(makeBrand('b-1', 'Acme'));
  product.category.setId('c-1');
  return product;
};

let repositories: {
  product: ReturnType<typeof makeInMemoryEntityRepository>;
  brand: ReturnType<typeof makeInMemoryEntityRepository>;
  category: ReturnType<typeof makeInMemoryEntityRepository>;
};

const adapters = (): MarketplaceAdminAdapters => ({
  productRest: Context.make(EntityRepositoryTag, repositories.product),
  productBrandRest: Context.make(EntityRepositoryTag, repositories.brand),
  productCategoryRest: Context.make(EntityRepositoryTag, repositories.category),
  configurationStore: Context.make(
    ConfigurationRepositoryTag,
    makeStubConfigurationStore(),
  ),
});

const renderPage = (page: ReactElement) =>
  render(
    <MarketplaceAdminAdaptersProvider adapters={adapters()}>
      {page}
    </MarketplaceAdminAdaptersProvider>,
  );

beforeEach(() => {
  push.mockClear();
  slug = 'new';
  repositories = {
    product: makeInMemoryEntityRepository([makeProduct()] as Entity[]),
    brand: makeInMemoryEntityRepository([makeBrand('b-1', 'Acme')] as Entity[]),
    category: makeInMemoryEntityRepository([
      makeCategory('c-1', 'Tools'),
    ] as Entity[]),
  };
});

describe('the listing pages', () => {
  it.each([
    ['brands', <ProductBrandListClientPage key="b" />, 'Acme'],
    ['categories', <ProductCategoryListClientPage key="c" />, 'Tools'],
    ['products', <ProductListClientPage key="p" />, 'Widget'],
  ])('lists %s from the adapters it was given', async (_label, page, expected) => {
    renderPage(page);

    await waitFor(() =>
      expect(screen.getAllByText(expected).length).toBeGreaterThan(0),
    );
  });

  // The product list is the one page that wires a link resolver, from the same
  // base adapters — that is what materializes the foreign-key category.
  it('resolves the product’s relations through the page’s resolver', async () => {
    renderPage(<ProductListClientPage />);

    await waitFor(() => expect(screen.getAllByText('Tools').length).toBeGreaterThan(0));
  });
});

describe('the single-record pages', () => {
  const cases = [
    ['brand', <ProductBrandSingleViewClientPage key="b" />, 'b-1', 'Acme'],
    ['category', <ProductCategorySingleViewClientPage key="c" />, 'c-1', 'Tools'],
    ['product', <ProductSingleViewClientPage key="p" />, 'p-1', 'Widget'],
  ] as const;

  it.each(cases)('loads the %s named by the route slug', async (_label, page, id, name) => {
    slug = id;

    renderPage(page);

    await waitFor(() => expect(screen.getByLabelText('name')).toHaveValue(name));
  });

  // The reserved `new` slug means there is nothing to load, so the form opens
  // empty and offers no delete — there is no record to delete yet.
  it.each(cases)('opens an empty %s form on the create slug', async (_label, page) => {
    renderPage(page);

    await waitFor(() => expect(screen.getByLabelText('name')).toHaveValue(''));
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  it.each(cases)('returns to the %s listing after a save', async (_label, page, id) => {
    slug = id;
    const user = userEvent.setup();
    renderPage(page);
    await waitFor(() => expect(screen.getByLabelText('name')).not.toHaveValue(''));

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
  });

  it.each(cases)('returns to the %s listing after a delete', async (_label, page, id) => {
    slug = id;
    const user = userEvent.setup();
    renderPage(page);
    await waitFor(() => expect(screen.getByLabelText('name')).not.toHaveValue(''));

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
  });

  // A failed write must leave the user on the form with their input intact,
  // not navigate away as though it had succeeded.
  it.each(cases)('stays on the %s form when the save fails', async (_label, page, id) => {
    slug = id;
    const user = userEvent.setup();
    renderPage(page);
    await waitFor(() => expect(screen.getByLabelText('name')).not.toHaveValue(''));
    repositories.product.failNext(new EntifixConnError('unreachable'));
    repositories.brand.failNext(new EntifixConnError('unreachable'));
    repositories.category.failNext(new EntifixConnError('unreachable'));

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByTestId('form-error')).toBeInTheDocument());
    expect(push).not.toHaveBeenCalled();
  });

  it.each(cases)('stays on the %s form when the delete fails', async (_label, page, id) => {
    slug = id;
    const user = userEvent.setup();
    renderPage(page);
    await waitFor(() => expect(screen.getByLabelText('name')).not.toHaveValue(''));
    repositories.product.failNext(new EntifixConnError('unreachable'));
    repositories.brand.failNext(new EntifixConnError('unreachable'));
    repositories.category.failNext(new EntifixConnError('unreachable'));

    await user.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.getByTestId('form-error')).toBeInTheDocument());
    expect(push).not.toHaveBeenCalled();
  });

  it.each(cases)('surfaces a %s load failure', async (_label, page, id) => {
    slug = id;
    repositories.product.failNext(new EntifixConnError('unreachable'));
    repositories.brand.failNext(new EntifixConnError('unreachable'));
    repositories.category.failNext(new EntifixConnError('unreachable'));

    renderPage(page);

    await waitFor(() => expect(screen.getByTestId('form-error')).toBeInTheDocument());
  });
});

describe('the product form’s relation pickers', () => {
  // The pickers come from the same base adapters pointed at a different
  // entity, and they must load the whole set rather than the default first
  // page of ten.
  it('offer every brand and category', async () => {
    slug = 'p-1';

    renderPage(<ProductSingleViewClientPage />);

    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Acme' })).toBeInTheDocument(),
    );
    expect(screen.getByRole('option', { name: 'Tools' })).toBeInTheDocument();
  });
});
