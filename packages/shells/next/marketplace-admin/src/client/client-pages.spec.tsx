import { EntityRepositoryTag } from '@entifix/business';
import { type EntityWriter, settled } from '@entifix/core';
import {
  describeEntityStateRules,
  describeEntityUseCases,
  type Entity,
  type EntityConstructor,
  type EntityMetadataDocument,
  type EntityMetadataSource,
  Unavailable,
} from '@entifix/core';
import { ReferenceLabelsHost } from '@entifix/next-shell';
import { EntifixQueryProvider } from '@entifix/react-integration';
import { makeInMemoryEntityRepository } from '@entifix/testing-unit';
import {
  ProductBrand,
  ProductCategory,
} from '@r10c/business-ts-catalog-reference';
import { ProductSpecification } from '@r10c/business-ts-product-configuration-management';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Context, Effect } from 'effect';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createClientAdapters } from './adapters/create-client-adapters.js';
import {
  ProductBrandListClientPage,
  ProductBrandSingleViewClientPage,
  ProductCategoryListClientPage,
  ProductCategorySingleViewClientPage,
  ProductListClientPage,
  ProductSingleViewClientPage,
} from './catalog-crud.js';
import type { MarketplaceAdminAdapters } from './client-types.js';
import { MarketplaceAdminAdaptersProvider } from './marketplace-admin-context/marketplace-admin-context.js';

/**
 * A writer that settles every write through the spec's own in-memory
 * repository, as a write that commits in one unit does (ADR 0073).
 */
const settledWriter = (
  context: Context.Context<EntityRepositoryTag>,
): EntityWriter => {
  const repository = Context.get(context, EntityRepositoryTag);
  return {
    save: entity => Effect.map(repository.save(entity), settled),
    delete: entityOrId =>
      Effect.as(repository.delete(entityOrId), settled(undefined)),
  };
};

/** The transports the shell really composes, so metadata reads behave as in production. */
const real = createClientAdapters();

// These six pages are `makeEntityCrud` output, not hand-written modules — which
// is exactly why the suite is unchanged from the one that covered the six
// hand-written ones. A generator earns its keep by passing the tests the code it
// replaced passed.
//
// The pages read the route through `next/navigation`, which only exists inside
// a running Next app; the slug is the one input a test needs to vary.
const push = vi.fn();
let slug = 'new';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useParams: () => ({ slug }),
  // A record page reads `?prefill.<member>=` since entifix 0.21.0.
  useSearchParams: () => new URLSearchParams(),
}));

const makeBrand = (id: string, name: string) => {
  const brand = new ProductBrand(name);
  brand.id = id;
  brand.revision = 1;
  return brand;
};

const makeCategory = (id: string, name: string) => {
  const category = new ProductCategory(id.toUpperCase(), {
    es: name,
    en: name,
  });
  category.id = id;
  category.revision = 1;
  return category;
};

const makeProduct = () => {
  const product = new ProductSpecification('P-1', 'Widget');
  product.id = 'p-1';
  product.revision = 1;
  product.brandId = 'b-1';
  product.categoryId = 'c-1';
  return product;
};

let repositories: {
  product: ReturnType<typeof makeInMemoryEntityRepository>;
  brand: ReturnType<typeof makeInMemoryEntityRepository>;
  category: ReturnType<typeof makeInMemoryEntityRepository>;
};

/**
 * The catalog's metadata as the service serves it for a product: the grants,
 * the four lifecycle verbs, and the states a version is saved and deleted in.
 * `undefined` keeps the real transport, which a spec has no server for.
 */
let catalogMetadata: EntityMetadataSource | undefined;

const adapters = (): MarketplaceAdminAdapters => ({
  productRest: Context.make(EntityRepositoryTag, repositories.product),
  productWriter: settledWriter(
    Context.make(EntityRepositoryTag, repositories.product),
  ),
  deviceModelRest: Context.make(EntityRepositoryTag, repositories.brand),
  deviceModelWriter: settledWriter(
    Context.make(EntityRepositoryTag, repositories.brand),
  ),
  productBrandRest: Context.make(EntityRepositoryTag, repositories.brand),
  productBrandWriter: settledWriter(
    Context.make(EntityRepositoryTag, repositories.brand),
  ),
  productCategoryRest: Context.make(EntityRepositoryTag, repositories.category),
  productCategoryWriter: settledWriter(
    Context.make(EntityRepositoryTag, repositories.category),
  ),
  // Neither page under test reads an offering; the keys exist because the
  // adapter set is one object and a partial one would not type.
  productOfferingRest: Context.make(EntityRepositoryTag, repositories.product),
  productOfferingWriter: settledWriter(
    Context.make(EntityRepositoryTag, repositories.product),
  ),
  productOfferingPriceRest: Context.make(
    EntityRepositoryTag,
    repositories.product,
  ),
  catalogImportRest: Context.make(EntityRepositoryTag, repositories.product),
  catalogImport: {
    readTable: () => Promise.resolve([]),
    references: () =>
      Promise.resolve({ brands: [], categories: [], deviceModels: [] }),
    submit: () => Promise.resolve({ ok: false, code: 'unexpected' }),
  },
  publishedVendorRest: Context.make(EntityRepositoryTag, repositories.product),
  productOfferingPriceWriter: settledWriter(
    Context.make(EntityRepositoryTag, repositories.product),
  ),
  referenceMetadata: real.referenceMetadata,
  catalogMetadata: catalogMetadata ?? real.catalogMetadata,
  productBrandUseCases: real.productBrandUseCases,
  deviceModelUseCases: real.deviceModelUseCases,
  productCategoryUseCases: real.productCategoryUseCases,
  productOfferingUseCases: real.productOfferingUseCases,
  productOfferingPriceUseCases: real.productOfferingPriceUseCases,
  productUseCases: real.productUseCases,
});

/**
 * A list names a reference through the host's registry since entifix 0.21.0
 * (entifix 0030), so the page is mounted under one, as the back office mounts
 * it — registering the spec's own vocabulary repositories.
 */
const renderPage = (page: ReactElement) =>
  render(
    <EntifixQueryProvider>
      <ReferenceLabelsHost
        registrations={[
          [ProductBrand, Context.make(EntityRepositoryTag, repositories.brand)],
          [
            ProductCategory,
            Context.make(EntityRepositoryTag, repositories.category),
          ],
        ]}
      >
        <MarketplaceAdminAdaptersProvider adapters={adapters()}>
          {page}
        </MarketplaceAdminAdaptersProvider>
      </ReferenceLabelsHost>
    </EntifixQueryProvider>,
  );

beforeEach(() => {
  push.mockClear();
  slug = 'new';
  catalogMetadata = undefined;
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

  // Brand and category live in another slice's store, so the product holds
  // their ids and the list asks the owning domain's repository for the names
  // (ADR 0022) — through the `links` the crud declares, never a join. Since
  // entifix 0.20.0 a cell shows that name, or an em dash when unset, and never
  // the id: a key is not what it means.
  it('renders an em dash for a product with no brand', async () => {
    const unclassified = new ProductSpecification('P-9', 'Doohickey');
    unclassified.id = 'p-9';
    repositories.product = makeInMemoryEntityRepository([
      unclassified,
    ] as Entity[]);

    renderPage(<ProductListClientPage />);

    await waitFor(() =>
      expect(screen.getAllByText('Doohickey').length).toBeGreaterThan(0),
    );
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('shows the classification names, never the ids it holds', async () => {
    renderPage(<ProductListClientPage />);

    await waitFor(() =>
      expect(screen.getAllByText('Acme').length).toBeGreaterThan(0),
    );
    expect(screen.getAllByText('Tools').length).toBeGreaterThan(0);
    expect(screen.queryByText('b-1')).toBeNull();
    expect(screen.queryByText('c-1')).toBeNull();
  });
});

/**
 * The name field. A category's name is localized (#565), so its form shows one
 * input per locale; the first is the default locale's, the one its label names.
 */
const nameInput = () => screen.getAllByLabelText(/nombre/i)[0];

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

      await waitFor(() => expect(nameInput()).toHaveValue(name));
    },
  );

  // The reserved `new` slug means there is nothing to load, so the form opens
  // empty and offers no delete — there is no record to delete yet.
  it.each(cases)(
    'opens an empty %s form on the create slug',
    async (_label, page) => {
      renderPage(page);

      await waitFor(() => expect(nameInput()).toHaveValue(''));
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
      await waitFor(() => expect(nameInput()).not.toHaveValue(''));

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
      await waitFor(() => expect(nameInput()).not.toHaveValue(''));

      await user.click(screen.getByRole('button', { name: 'Eliminar' }));
      // Delete asks first since entifix 0.20.0; the verb inside the dialog acts.
      await user.click(
        within(screen.getByRole('alertdialog')).getByRole('button', {
          name: 'Eliminar',
        }),
      );

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
      await waitFor(() => expect(nameInput()).not.toHaveValue(''));
      repositories.product.failNext(
        new Unavailable({ dependency: 'unreachable' }),
      );
      repositories.brand.failNext(
        new Unavailable({ dependency: 'unreachable' }),
      );
      repositories.category.failNext(
        new Unavailable({ dependency: 'unreachable' }),
      );

      await user.click(screen.getByRole('button', { name: 'Guardar' }));

      await waitFor(() =>
        expect(screen.getByTestId('region-state-error')).toBeInTheDocument(),
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
      await waitFor(() => expect(nameInput()).not.toHaveValue(''));
      repositories.product.failNext(
        new Unavailable({ dependency: 'unreachable' }),
      );
      repositories.brand.failNext(
        new Unavailable({ dependency: 'unreachable' }),
      );
      repositories.category.failNext(
        new Unavailable({ dependency: 'unreachable' }),
      );

      await user.click(screen.getByRole('button', { name: 'Eliminar' }));
      // Delete asks first since entifix 0.20.0; the verb inside the dialog acts.
      await user.click(
        within(screen.getByRole('alertdialog')).getByRole('button', {
          name: 'Eliminar',
        }),
      );

      await waitFor(() =>
        expect(screen.getByTestId('region-state-error')).toBeInTheDocument(),
      );
      expect(push).not.toHaveBeenCalled();
    },
  );

  it.each(cases)('surfaces a %s load failure', async (_label, page, id) => {
    slug = id;
    repositories.product.failNext(
      new Unavailable({ dependency: 'unreachable' }),
    );
    repositories.brand.failNext(new Unavailable({ dependency: 'unreachable' }));
    // Aimed at `get`, the record load under test, rather than "the next call":
    // the category form also searches this repository for its parent picker
    // (ADR 0062), and that query can arrive first.
    vi.spyOn(repositories.category, 'get').mockReturnValueOnce(
      Effect.fail(new Unavailable({ dependency: 'unreachable' })),
    );

    renderPage(page);

    await waitFor(() =>
      expect(screen.getByTestId('region-state-error')).toBeInTheDocument(),
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

/**
 * #767: a released version is frozen (ADR 0079 §1), and the page says so
 * instead of offering a Save the service always refuses.
 */
describe('a product version’s state', () => {
  const served = (): EntityMetadataSource => ({
    fetchMetadata: <TEntity extends Entity>(
      entityConstructor: EntityConstructor<TEntity>,
    ) =>
      Promise.resolve({
        actions: ['read', 'write', 'delete'],
        useCases: describeEntityUseCases(entityConstructor),
        ...describeEntityStateRules(entityConstructor),
      } satisfies EntityMetadataDocument),
  });
  const inState = (lifecycleStatus: 'in-design' | 'active') => {
    const product = makeProduct();
    product.lifecycleStatus = lifecycleStatus;
    repositories.product = makeInMemoryEntityRepository([product] as Entity[]);
  };

  it('renders a released version read-only, offering a New version', async () => {
    inState('active');
    catalogMetadata = served();
    slug = 'p-1';

    renderPage(<ProductSingleViewClientPage />);

    expect(
      await screen.findByTestId('entity-form-read-only'),
    ).toHaveTextContent('Esta versión está publicada');
    expect(screen.queryByRole('textbox', { name: 'Nombre' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Guardar' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Eliminar' })).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Nueva versión' }),
    ).toBeInTheDocument();
  });

  it('keeps a version in design editable', async () => {
    inState('in-design');
    catalogMetadata = served();
    slug = 'p-1';

    renderPage(<ProductSingleViewClientPage />);

    await waitFor(() => expect(nameInput()).toHaveValue('Widget'));
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeInTheDocument();
    expect(screen.queryByTestId('entity-form-read-only')).toBeNull();
  });
});
