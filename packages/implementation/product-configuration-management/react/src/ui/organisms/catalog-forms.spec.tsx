import {
  Product,
  ProductBrand,
  ProductCategory,
} from '@r10c/business-ts-product-configuration-management';
import {
  EntifixQueryProvider,
  type EntityLinkSourceConfig,
} from '@r10c/entifix-react-integration';
import {
  ConfigurationRepositoryTag,
  type EntityRepository,
  EntityRepositoryTag,
  getUCFactory,
  loadUCFactory,
} from '@r10c/entifix-ts-business';
import {
  EntifixConnError,
  type Entity,
  type EntityConstructor,
} from '@r10c/entifix-ts-core';
import {
  makeInMemoryEntityRepository,
  makeStubConfigurationStore,
} from '@r10c/entifix-ts-testing-unit';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Context } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProductBrandForm } from './product-brand-form/product-brand-form.js';
import { ProductCategoryForm } from './product-category-form/product-category-form.js';
import { ProductForm } from './product-form/product-form.js';

const makeBrand = (id: string, name: string) => {
  const brand = new ProductBrand(name);
  brand.id = id;
  return brand;
};

const makeCategory = (id: string, code: string, name: string) => {
  const category = new ProductCategory(code, name);
  category.id = id;
  return category;
};

const brands = [makeBrand('b-1', 'Acme'), makeBrand('b-2', 'Globex')];
const categories = [makeCategory('c-1', 'TOOLS', 'Tools')];

type Ctx = ConfigurationRepositoryTag | EntityRepositoryTag;

let brandRepository: EntityRepository;
let categoryRepository: EntityRepository;

/**
 * The picker configuration a page would build: the real use-cases over an
 * in-memory repository, so these cases exercise search and selection end to end
 * rather than a stubbed source.
 */
const linkConfig = <TTarget extends Entity>(
  entityConstructor: EntityConstructor<TTarget>,
  repository: EntityRepository,
): EntityLinkSourceConfig<TTarget, Ctx> => ({
  entityConstructor,
  loadUc: loadUCFactory<TTarget>(),
  getUc: getUCFactory<TTarget>(),
  ctx: Context.make(EntityRepositoryTag, repository).pipe(
    Context.add(ConfigurationRepositoryTag, makeStubConfigurationStore()),
  ),
  debounceMs: 0,
});

beforeEach(() => {
  brandRepository = makeInMemoryEntityRepository([...brands]);
  categoryRepository = makeInMemoryEntityRepository([...categories]);
});

describe('ProductBrandForm', () => {
  const renderForm = (
    props: Partial<Parameters<typeof ProductBrandForm>[0]> = {},
  ) => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<ProductBrandForm onSave={onSave} backHref="/catalog" {...props} />);
    return { onSave, user };
  };

  it('titles itself for a create when there is no record', () => {
    renderForm();

    expect(
      screen.getByRole('heading', { name: 'Nueva marca' }),
    ).toBeInTheDocument();
  });

  it('titles itself for an edit and seeds the fields from the record', () => {
    const brand = makeBrand('b-1', 'Acme');
    brand.description = 'A brand';
    brand.website = 'https://acme.test';

    renderForm({ entity: brand });

    expect(
      screen.getByRole('heading', { name: 'Editar marca' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre')).toHaveValue('Acme');
    expect(screen.getByLabelText('Descripción')).toHaveValue('A brand');
    expect(screen.getByLabelText('Sitio web')).toHaveValue('https://acme.test');
  });

  it('hands a fully-built entity to onSave', async () => {
    const { onSave, user } = renderForm();

    await user.type(screen.getByLabelText('Nombre'), 'Acme');
    await user.type(screen.getByLabelText('Descripción'), 'A brand');
    await user.type(screen.getByLabelText('Sitio web'), 'https://acme.test');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    const saved = onSave.mock.calls[0]?.[0] as ProductBrand;
    expect(saved).toBeInstanceOf(ProductBrand);
    expect(saved.name).toBe('Acme');
    expect(saved.description).toBe('A brand');
    expect(saved.website).toBe('https://acme.test');
  });

  // `code` is assigned by the create transaction and never edited here, so an
  // update has to carry it back — rebuilding without it blanks the identifier.
  it('carries the record’s id and transaction-assigned code through an update', async () => {
    const brand = makeBrand('b-1', 'Acme');
    brand.code = 'brand-001';
    const { onSave, user } = renderForm({ entity: brand });

    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    const saved = onSave.mock.calls[0]?.[0] as ProductBrand;
    expect(saved.id).toBe('b-1');
    expect(saved.code).toBe('brand-001');
  });

  it('keeps the assigned code off the form', () => {
    const brand = makeBrand('b-1', 'Acme');
    brand.code = 'brand-001';
    renderForm({ entity: brand });

    expect(screen.queryByLabelText('Código')).not.toBeInTheDocument();
  });

  // An empty text box means "not set", not the empty string — persisting `''`
  // would make an absent optional indistinguishable from a cleared one.
  it('sends undefined rather than an empty string for untouched optionals', async () => {
    const { onSave, user } = renderForm();

    await user.type(screen.getByLabelText('Nombre'), 'Acme');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    const saved = onSave.mock.calls[0]?.[0] as ProductBrand;
    expect(saved.description).toBeUndefined();
    expect(saved.website).toBeUndefined();
  });

  it('reports loading and failure', () => {
    renderForm({ isLoading: true, error: new EntifixConnError('unreachable') });

    expect(screen.getByTestId('entity-form-loading')).toBeInTheDocument();
    expect(screen.getByTestId('entity-form-error')).toHaveTextContent(
      'unreachable',
    );
  });

  it('offers delete only when the page provides a handler', async () => {
    const onDelete = vi.fn();
    const { user } = renderForm({ onDelete });

    expect(
      screen.getByRole('button', { name: 'Eliminar' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Eliminar' }));
    expect(onDelete).toHaveBeenCalled();
  });

  it('omits delete without a handler', () => {
    renderForm();

    expect(
      screen.queryByRole('button', { name: 'Eliminar' }),
    ).not.toBeInTheDocument();
  });

  // Any in-flight write disables every action, so a double submit or a
  // save-then-delete race is impossible.
  it.each([
    ['saving', { isSaving: true }, 'Guardando…'],
    ['deleting', { isDeleting: true }, 'Eliminando…'],
  ])('disables every action while %s', (_label, props, busyLabel) => {
    renderForm({ ...props, onDelete: vi.fn() });

    expect(screen.getByText(busyLabel)).toBeInTheDocument();
    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled();
    }
  });

  it('links back to the listing', () => {
    renderForm();

    expect(
      screen.getByRole('button', { name: 'Volver' }).parentElement,
    ).toHaveAttribute('href', '/catalog');
  });
});

describe('ProductCategoryForm', () => {
  const renderForm = (
    props: Partial<Parameters<typeof ProductCategoryForm>[0]> = {},
  ) => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(
      <ProductCategoryForm onSave={onSave} backHref="/catalog" {...props} />,
    );
    return { onSave, user };
  };

  it('seeds from the record and hands back a built entity', async () => {
    const { onSave, user } = renderForm({
      entity: makeCategory('c-1', 'TOOLS', 'Tools'),
    });

    expect(screen.getByLabelText('Código')).toHaveValue('TOOLS');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    const saved = onSave.mock.calls[0]?.[0] as ProductCategory;
    expect(saved).toBeInstanceOf(ProductCategory);
    expect(saved.id).toBe('c-1');
    expect(saved.name).toBe('Tools');
  });

  it('titles itself for a create when there is no record', () => {
    renderForm();

    expect(
      screen.getByRole('heading', { name: 'Nueva categoría' }),
    ).toBeInTheDocument();
  });

  it('builds an entity from what was typed', async () => {
    const { onSave, user } = renderForm();

    await user.type(screen.getByLabelText('Código'), 'TOOLS');
    await user.type(screen.getByLabelText('Nombre'), 'Tools');
    await user.type(screen.getByLabelText('Descripción'), 'Hand tools');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    const saved = onSave.mock.calls[0]?.[0] as ProductCategory;
    expect(saved.code).toBe('TOOLS');
    expect(saved.name).toBe('Tools');
    expect(saved.description).toBe('Hand tools');
  });

  it('sends undefined rather than an empty description', async () => {
    const { onSave, user } = renderForm();

    await user.type(screen.getByLabelText('Código'), 'TOOLS');
    await user.type(screen.getByLabelText('Nombre'), 'Tools');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect(
      (onSave.mock.calls[0]?.[0] as ProductCategory).description,
    ).toBeUndefined();
  });

  it('reports loading and failure', () => {
    renderForm({ isLoading: true, error: new EntifixConnError('unreachable') });

    expect(screen.getByTestId('entity-form-loading')).toBeInTheDocument();
    expect(screen.getByTestId('entity-form-error')).toHaveTextContent(
      'unreachable',
    );
  });

  it('offers delete only when the page provides a handler', () => {
    renderForm({ onDelete: vi.fn() });

    expect(
      screen.getByRole('button', { name: 'Eliminar' }),
    ).toBeInTheDocument();
  });

  // Any in-flight write disables every action, so a double submit or a
  // save-then-delete race is impossible.
  it.each([
    ['saving', { isSaving: true }, 'Guardando…'],
    ['deleting', { isDeleting: true }, 'Eliminando…'],
  ])('disables every action while %s', (_label, props, busyLabel) => {
    renderForm({ ...props, onDelete: vi.fn() });

    expect(screen.getByText(busyLabel)).toBeInTheDocument();
    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled();
    }
  });
});

describe('ProductForm', () => {
  const renderForm = (
    props: Partial<Parameters<typeof ProductForm<Ctx>>[0]> = {},
  ) => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(
      <EntifixQueryProvider>
        <ProductForm<Ctx>
          brandLink={linkConfig(ProductBrand, brandRepository)}
          categoryLink={linkConfig(ProductCategory, categoryRepository)}
          onSave={onSave}
          backHref="/catalog"
          {...props}
        />
      </EntifixQueryProvider>,
    );
    return { onSave, user };
  };

  const makeProduct = () => {
    const product = new Product('P-1', 'Widget');
    product.id = 'p-1';
    product.brand.setValue(brands[0]!);
    product.category.setId('c-1');
    return product;
  };

  /** Picks a target through the quick search of one relation. */
  const pick = async (
    user: ReturnType<typeof userEvent.setup>,
    field: string,
    option: string,
  ) => {
    await user.click(
      screen.getByRole('button', { name: `Ver sugerencias de ${field}` }),
    );
    await user.click(await screen.findByRole('option', { name: option }));
  };

  it('offers the catalog through each relation’s quick search', async () => {
    const { user } = renderForm();

    await pick(user, 'Marca', 'Acme');

    expect(screen.getByTestId('entity-link-value-brand')).toHaveTextContent(
      'Acme',
    );
  });

  it('seeds both relation editors from the record', async () => {
    renderForm({ entity: makeProduct() });

    // `brand` arrived embedded, so its name is already known; `category` arrived
    // as a bare key and is resolved through the picker's get use-case.
    expect(screen.getByTestId('entity-link-value-brand')).toHaveTextContent(
      'Acme',
    );
    expect(
      await screen.findByText('Tools', { selector: 'span' }),
    ).toBeInTheDocument();
  });

  // The two relations are stored differently, and the entity is what says so:
  // `brand` declares `linkSerialization: 'embedded'`, `category` keeps the
  // default. The form applies whatever each declares.
  it('embeds the chosen brand but stores the category as a foreign key', async () => {
    const { onSave, user } = renderForm();

    await user.type(screen.getByLabelText('Código'), 'P-1');
    await user.type(screen.getByLabelText('Nombre'), 'Widget');
    await user.type(screen.getByLabelText('Descripción'), 'A product');
    await pick(user, 'Marca', 'Globex');
    await pick(user, 'Categoría', 'Tools');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    const saved = onSave.mock.calls[0]?.[0] as Product;
    expect(saved.brand.isLoaded).toBe(true);
    expect(saved.brand.value?.name).toBe('Globex');
    expect(saved.category.isLoaded).toBe(false);
    expect(saved.category.id).toBe('c-1');
  });

  it('leaves both relations empty when neither was chosen', async () => {
    const { onSave, user } = renderForm();

    await user.type(screen.getByLabelText('Código'), 'P-1');
    await user.type(screen.getByLabelText('Nombre'), 'Widget');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    const saved = onSave.mock.calls[0]?.[0] as Product;
    expect(saved.brand.isLoaded).toBe(false);
    expect(saved.category.id).toBeUndefined();
  });

  it('drops a relation the user cleared', async () => {
    const { onSave, user } = renderForm({ entity: makeProduct() });

    await user.click(screen.getByRole('button', { name: 'Quitar Marca' }));
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    const saved = onSave.mock.calls[0]?.[0] as Product;
    expect(saved.brand.isLoaded).toBe(false);
    expect(saved.brand.id).toBeUndefined();
  });

  it('carries the record’s id through an update', async () => {
    const { onSave, user } = renderForm({ entity: makeProduct() });

    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    expect((onSave.mock.calls[0]?.[0] as Product).id).toBe('p-1');
  });

  it('reports loading and failure', () => {
    renderForm({ isLoading: true, error: new EntifixConnError('unreachable') });

    expect(screen.getByTestId('entity-form-loading')).toBeInTheDocument();
    expect(screen.getByTestId('entity-form-error')).toHaveTextContent(
      'unreachable',
    );
  });

  it('offers delete only when the page provides a handler', () => {
    renderForm({ onDelete: vi.fn() });

    expect(
      screen.getByRole('button', { name: 'Eliminar' }),
    ).toBeInTheDocument();
  });

  // Any in-flight write disables every action, so a double submit or a
  // save-then-delete race is impossible.
  it.each([
    ['saving', { isSaving: true }, 'Guardando…'],
    ['deleting', { isDeleting: true }, 'Eliminando…'],
  ])('disables every action while %s', (_label, props, busyLabel) => {
    renderForm({ ...props, onDelete: vi.fn() });

    expect(screen.getByText(busyLabel)).toBeInTheDocument();
    expect(screen.getByText(busyLabel)).toBeDisabled();
  });
});
