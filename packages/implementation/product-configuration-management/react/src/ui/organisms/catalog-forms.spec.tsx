import {
  ProductBrand,
  ProductCategory,
} from '@r10c/business-ts-catalog-reference';
import { ProductSpecification } from '@r10c/business-ts-product-configuration-management';
import { EntifixQueryProvider } from '@r10c/entifix-react-integration';
import { EntifixConnError } from '@r10c/entifix-ts-core';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

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
    props: Partial<Parameters<typeof ProductForm>[0]> = {},
  ) => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(
      <EntifixQueryProvider>
        <ProductForm onSave={onSave} backHref="/catalog" {...props} />
      </EntifixQueryProvider>,
    );
    return { onSave, user };
  };

  const makeProduct = () => {
    const product = new ProductSpecification('P-1', 'Widget');
    product.id = 'p-1';
    product.brandId = 'product-brand-1';
    product.categoryId = 'product-category-1';
    return product;
  };

  it('renders the classifications as plain id fields', async () => {
    // They were relation pickers until ADR 0022 moved their targets into
    // another slice's store. A picker over a scalar id is follow-up work; what
    // must not regress is that the ids remain editable at all.
    renderForm({ entity: makeProduct() });

    expect(await screen.findByDisplayValue('product-brand-1')).toBeVisible();
    expect(screen.getByDisplayValue('product-category-1')).toBeVisible();
  });

  it('submits the ids the user typed', async () => {
    const { onSave, user } = renderForm({ entity: makeProduct() });

    const brand = await screen.findByDisplayValue('product-brand-1');
    await user.clear(brand);
    await user.type(brand, 'product-brand-7');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = onSave.mock.calls[0]?.[0] as ProductSpecification;
    expect(saved.brandId).toBe('product-brand-7');
    expect(saved.categoryId).toBe('product-category-1');
  });

  it('clears a classification the user empties', async () => {
    // An empty input means "unclassified", not the empty string — a dangling or
    // absent reference is a display gap, never a broken record.
    const { onSave, user } = renderForm({ entity: makeProduct() });

    await user.clear(await screen.findByDisplayValue('product-category-1'));
    await user.clear(screen.getByDisplayValue('product-brand-1'));
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = onSave.mock.calls[0]?.[0] as ProductSpecification;
    expect(saved.categoryId).toBeUndefined();
    expect(saved.brandId).toBeUndefined();
  });

  it('creates a specification from an empty form', async () => {
    // Create mode renders the other title and starts with no entity, which is
    // also the only path where a typed description reaches the submit branch.
    const { onSave, user } = renderForm();

    await user.type(screen.getByLabelText('Código'), 'P-9');
    await user.type(screen.getByLabelText('Nombre'), 'Gizmo');
    await user.type(screen.getByLabelText('Descripción'), 'A gizmo');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const saved = onSave.mock.calls[0]?.[0] as ProductSpecification;
    expect(saved.code).toBe('P-9');
    expect(saved.description).toBe('A gizmo');
    expect(saved.id).toBeUndefined();
  });

  it('seeds from a persisted draft instead of the entity', async () => {
    renderForm({
      entity: makeProduct(),
      initialDraft: {
        code: 'P-1',
        name: 'Widget',
        description: '',
        brandId: 'product-brand-9',
        categoryId: '',
      },
    });

    expect(await screen.findByDisplayValue('product-brand-9')).toBeVisible();
  });
});
