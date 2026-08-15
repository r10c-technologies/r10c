import {
  ProductBrand,
  ProductCategory,
} from '@r10c/business-ts-catalog-reference';
import { ProductSpecification } from '@r10c/business-ts-product-configuration-management';
import { EntifixQueryProvider } from '@r10c/entifix-react-integration';
import {
  ConfigurationRepositoryTag,
  EntityRepositoryTag,
} from '@r10c/entifix-ts-business';
import { EntifixConnError, type Entity } from '@r10c/entifix-ts-core';
import {
  makeInMemoryEntityRepository,
  makeStubConfigurationClient,
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
  const product = new ProductSpecification('P-1', 'Widget');
  product.id = 'p-1';
  product.brandId = 'b-1';
  product.categoryId = 'c-1';
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
    makeStubConfigurationClient(),
  ),
});

const renderPage = (page: ReactElement) =>
  render(
    <EntifixQueryProvider>
      <MarketplaceAdminAdaptersProvider adapters={adapters()}>
        {page}
      </MarketplaceAdminAdaptersProvider>
    </EntifixQueryProvider>,
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
  ])(
    'lists %s from the adapters it was given',
    async (_label, page, expected) => {
      renderPage(page);

      await waitFor(() =>
        expect(screen.getAllByText(expected).length).toBeGreaterThan(0),
      );
    },
  );

  // The product list used to wire a link resolver here, which is what
  // materialized the foreign-key category. It does not any more: brand and
  // category live in another slice's store, so the list shows the ids it holds
  // and a screen wanting names asks the owning domain (ADR 0022).
  it('shows the classification ids it holds, without resolving them', async () => {
    renderPage(<ProductListClientPage />);

    await waitFor(() =>
      expect(screen.getAllByText('b-1').length).toBeGreaterThan(0),
    );
    expect(screen.queryByText('Tools')).toBeNull();
  });
});

describe('the single-record pages', () => {
  const cases = [
    ['brand', <ProductBrandSingleViewClientPage key="b" />, 'b-1', 'Acme'],
    [
      'category',
      <ProductCategorySingleViewClientPage key="c" />,
      'c-1',
      'Tools',
    ],
    ['product', <ProductSingleViewClientPage key="p" />, 'p-1', 'Widget'],
  ] as const;

  it.each(cases)(
    'loads the %s named by the route slug',
    async (_label, page, id, name) => {
      slug = id;

      renderPage(page);

      await waitFor(() =>
        expect(screen.getByLabelText(/nombre/i)).toHaveValue(name),
      );
    },
  );

  // The reserved `new` slug means there is nothing to load, so the form opens
  // empty and offers no delete — there is no record to delete yet.
  it.each(cases)(
    'opens an empty %s form on the create slug',
    async (_label, page) => {
      renderPage(page);

      await waitFor(() =>
        expect(screen.getByLabelText(/nombre/i)).toHaveValue(''),
      );
      expect(
        screen.queryByRole('button', { name: 'Eliminar' }),
      ).not.toBeInTheDocument();
    },
  );

  it.each(cases)(
    'returns to the %s listing after a save',
    async (_label, page, id) => {
      slug = id;
      const user = userEvent.setup();
      renderPage(page);
      await waitFor(() =>
        expect(screen.getByLabelText(/nombre/i)).not.toHaveValue(''),
      );

      await user.click(screen.getByRole('button', { name: 'Guardar' }));

      await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    },
  );

  it.each(cases)(
    'returns to the %s listing after a delete',
    async (_label, page, id) => {
      slug = id;
      const user = userEvent.setup();
      renderPage(page);
      await waitFor(() =>
        expect(screen.getByLabelText(/nombre/i)).not.toHaveValue(''),
      );

      await user.click(screen.getByRole('button', { name: 'Eliminar' }));

      await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    },
  );

  // A failed write must leave the user on the form with their input intact,
  // not navigate away as though it had succeeded.
  it.each(cases)(
    'stays on the %s form when the save fails',
    async (_label, page, id) => {
      slug = id;
      const user = userEvent.setup();
      renderPage(page);
      await waitFor(() =>
        expect(screen.getByLabelText(/nombre/i)).not.toHaveValue(''),
      );
      repositories.product.failNext(new EntifixConnError('unreachable'));
      repositories.brand.failNext(new EntifixConnError('unreachable'));
      repositories.category.failNext(new EntifixConnError('unreachable'));

      await user.click(screen.getByRole('button', { name: 'Guardar' }));

      await waitFor(() =>
        expect(screen.getByTestId(/form-error$/)).toBeInTheDocument(),
      );
      expect(push).not.toHaveBeenCalled();
    },
  );

  it.each(cases)(
    'stays on the %s form when the delete fails',
    async (_label, page, id) => {
      slug = id;
      const user = userEvent.setup();
      renderPage(page);
      await waitFor(() =>
        expect(screen.getByLabelText(/nombre/i)).not.toHaveValue(''),
      );
      repositories.product.failNext(new EntifixConnError('unreachable'));
      repositories.brand.failNext(new EntifixConnError('unreachable'));
      repositories.category.failNext(new EntifixConnError('unreachable'));

      await user.click(screen.getByRole('button', { name: 'Eliminar' }));

      await waitFor(() =>
        expect(screen.getByTestId(/form-error$/)).toBeInTheDocument(),
      );
      expect(push).not.toHaveBeenCalled();
    },
  );

  it.each(cases)('surfaces a %s load failure', async (_label, page, id) => {
    slug = id;
    repositories.product.failNext(new EntifixConnError('unreachable'));
    repositories.brand.failNext(new EntifixConnError('unreachable'));
    repositories.category.failNext(new EntifixConnError('unreachable'));

    renderPage(page);

    await waitFor(() =>
      expect(screen.getByTestId(/form-error$/)).toBeInTheDocument(),
    );
  });
});

describe('the product form’s classifications', () => {
  // `ProductSpecification` carries plain ids, because the two catalogs moved to
  // `catalog-reference` — another slice's store — and a typed link across that
  // boundary is not a legal edge (ADR 0022). The picker is back over those
  // scalars, which is what this page is on the hook for: it composes the
  // sources, and it has to point them at the **other** service.
  it('resolves each held id through its own service', async () => {
    slug = 'p-1';

    renderPage(<ProductSingleViewClientPage />);

    // Names, not ids — and they can only have come from `productBrandRest` /
    // `productCategoryRest`, since the product repository holds neither record.
    await waitFor(() =>
      expect(screen.getByTestId('entity-link-value-brandId')).toHaveTextContent(
        'Acme',
      ),
    );
    expect(
      screen.getByTestId('entity-link-value-categoryId'),
    ).toHaveTextContent('Tools');
  });

  // Nothing enforces either reference across the store boundary — no foreign
  // key spans two slices — so a target that was deleted leaves an id pointing at
  // nothing. That is a display gap, never a corrupt record, and the field has to
  // keep showing the key rather than emptying itself.
  it('falls back to the bare id when a target no longer exists', async () => {
    const orphan = new ProductSpecification('P-2', 'Gizmo');
    orphan.id = 'p-2';
    orphan.brandId = 'b-404';
    orphan.categoryId = 'c-1';
    repositories.product = makeInMemoryEntityRepository([orphan] as Entity[]);
    slug = 'p-2';

    renderPage(<ProductSingleViewClientPage />);

    await waitFor(() =>
      expect(
        screen.getByTestId('entity-link-value-categoryId'),
      ).toHaveTextContent('Tools'),
    );
    expect(screen.getByTestId('entity-link-value-brandId')).toHaveTextContent(
      'b-404',
    );
  });
});
