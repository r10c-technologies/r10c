import {
  Product,
  ProductBrand,
  ProductCategory,
} from '@r10c/business-ts-product-configuration-management';
import { EntifixConnError } from '@r10c/entifix-ts-core';
import { render, screen } from '@testing-library/react';
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

const brands = [makeBrand('b-1', 'Acme'), makeBrand('b-2', 'Globex')];
const categories = [makeCategory('c-1', 'TOOLS', 'Tools')];

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

    expect(screen.getByRole('heading', { name: 'New product brand' })).toBeInTheDocument();
  });

  it('titles itself for an edit and seeds the fields from the record', () => {
    const brand = makeBrand('b-1', 'Acme');
    brand.description = 'A brand';
    brand.website = 'https://acme.test';

    renderForm({ entity: brand });

    expect(screen.getByRole('heading', { name: 'Edit product brand' })).toBeInTheDocument();
    expect(screen.getByLabelText('name')).toHaveValue('Acme');
    expect(screen.getByLabelText('description')).toHaveValue('A brand');
    expect(screen.getByLabelText('website')).toHaveValue('https://acme.test');
  });

  it('hands a fully-built entity to onSave', async () => {
    const { onSave, user } = renderForm();

    await user.type(screen.getByLabelText('name'), 'Acme');
    await user.type(screen.getByLabelText('description'), 'A brand');
    await user.type(screen.getByLabelText('website'), 'https://acme.test');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const saved = onSave.mock.calls[0]?.[0] as ProductBrand;
    expect(saved).toBeInstanceOf(ProductBrand);
    expect(saved.name).toBe('Acme');
    expect(saved.description).toBe('A brand');
    expect(saved.website).toBe('https://acme.test');
  });

  it('carries the record’s id through an update', async () => {
    const { onSave, user } = renderForm({ entity: makeBrand('b-1', 'Acme') });

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect((onSave.mock.calls[0]?.[0] as ProductBrand).id).toBe('b-1');
  });

  // An empty text box means "not set", not the empty string — persisting `''`
  // would make an absent optional indistinguishable from a cleared one.
  it('sends undefined rather than an empty string for untouched optionals', async () => {
    const { onSave, user } = renderForm();

    await user.type(screen.getByLabelText('name'), 'Acme');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const saved = onSave.mock.calls[0]?.[0] as ProductBrand;
    expect(saved.description).toBeUndefined();
    expect(saved.website).toBeUndefined();
  });

  it('reports loading and failure', () => {
    renderForm({ isLoading: true, error: new EntifixConnError('unreachable') });

    expect(screen.getByTestId('form-loading')).toBeInTheDocument();
    expect(screen.getByTestId('form-error')).toHaveTextContent('unreachable');
  });

  it('offers delete only when the page provides a handler', async () => {
    const onDelete = vi.fn();
    const { user } = renderForm({ onDelete });

    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalled();
  });

  it('omits delete without a handler', () => {
    renderForm();

    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });

  // Any in-flight write disables every action, so a double submit or a
  // save-then-delete race is impossible.
  it.each([
    ['saving', { isSaving: true }, 'Saving…'],
    ['deleting', { isDeleting: true }, 'Deleting…'],
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
      screen.getByRole('button', { name: 'Back' }).parentElement,
    ).toHaveAttribute('href', '/catalog');
  });
});

describe('ProductCategoryForm', () => {
  const renderForm = (
    props: Partial<Parameters<typeof ProductCategoryForm>[0]> = {},
  ) => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<ProductCategoryForm onSave={onSave} backHref="/catalog" {...props} />);
    return { onSave, user };
  };

  it('seeds from the record and hands back a built entity', async () => {
    const { onSave, user } = renderForm({
      entity: makeCategory('c-1', 'TOOLS', 'Tools'),
    });

    expect(screen.getByLabelText('code')).toHaveValue('TOOLS');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const saved = onSave.mock.calls[0]?.[0] as ProductCategory;
    expect(saved).toBeInstanceOf(ProductCategory);
    expect(saved.id).toBe('c-1');
    expect(saved.name).toBe('Tools');
  });

  it('titles itself for a create when there is no record', () => {
    renderForm();

    expect(
      screen.getByRole('heading', { name: /New product category/i }),
    ).toBeInTheDocument();
  });

  it('builds an entity from what was typed', async () => {
    const { onSave, user } = renderForm();

    await user.type(screen.getByLabelText('code'), 'TOOLS');
    await user.type(screen.getByLabelText('name'), 'Tools');
    await user.type(screen.getByLabelText('description'), 'Hand tools');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const saved = onSave.mock.calls[0]?.[0] as ProductCategory;
    expect(saved.code).toBe('TOOLS');
    expect(saved.name).toBe('Tools');
    expect(saved.description).toBe('Hand tools');
  });

  it('sends undefined rather than an empty description', async () => {
    const { onSave, user } = renderForm();

    await user.type(screen.getByLabelText('code'), 'TOOLS');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect((onSave.mock.calls[0]?.[0] as ProductCategory).description).toBeUndefined();
  });

  it('reports loading and failure', () => {
    renderForm({ isLoading: true, error: new EntifixConnError('unreachable') });

    expect(screen.getByTestId('form-loading')).toBeInTheDocument();
    expect(screen.getByTestId('form-error')).toHaveTextContent('unreachable');
  });

  it('offers delete only when the page provides a handler', () => {
    renderForm({ onDelete: vi.fn() });

    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  // Any in-flight write disables every action, so a double submit or a
  // save-then-delete race is impossible.
  it.each([
    ['saving', { isSaving: true }, 'Saving…'],
    ['deleting', { isDeleting: true }, 'Deleting…'],
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
      <ProductForm
        brands={brands}
        categories={categories}
        onSave={onSave}
        backHref="/catalog"
        {...props}
      />,
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

  it('offers every brand and category as an option', () => {
    renderForm();

    expect(screen.getByRole('option', { name: 'Acme' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Tools' })).toBeInTheDocument();
  });

  it('seeds both relation pickers from the record', () => {
    renderForm({ entity: makeProduct() });

    expect(screen.getByLabelText(/brand/)).toHaveValue('b-1');
    expect(screen.getByLabelText(/category/)).toHaveValue('c-1');
  });

  // The two relations are stored differently, and the form has to build each
  // link the way the payload will carry it: brand embedded, category by id.
  it('embeds the chosen brand but stores the category as a foreign key', async () => {
    const { onSave, user } = renderForm();

    await user.type(screen.getByLabelText('code'), 'P-1');
    await user.type(screen.getByLabelText('name'), 'Widget');
    await user.type(screen.getByLabelText('description'), 'A product');
    await user.selectOptions(screen.getByLabelText(/brand/), 'b-2');
    await user.selectOptions(screen.getByLabelText(/category/), 'c-1');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const saved = onSave.mock.calls[0]?.[0] as Product;
    expect(saved.brand.isLoaded).toBe(true);
    expect(saved.brand.value?.name).toBe('Globex');
    expect(saved.category.isLoaded).toBe(false);
    expect(saved.category.id).toBe('c-1');
  });

  it('leaves both relations empty when neither was chosen', async () => {
    const { onSave, user } = renderForm();

    await user.type(screen.getByLabelText('code'), 'P-1');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const saved = onSave.mock.calls[0]?.[0] as Product;
    expect(saved.brand.isLoaded).toBe(false);
    expect(saved.category.id).toBeUndefined();
  });

  it('carries the record’s id through an update', async () => {
    const { onSave, user } = renderForm({ entity: makeProduct() });

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect((onSave.mock.calls[0]?.[0] as Product).id).toBe('p-1');
  });

  it('reports loading and failure', () => {
    renderForm({ isLoading: true, error: new EntifixConnError('unreachable') });

    expect(screen.getByTestId('form-loading')).toBeInTheDocument();
    expect(screen.getByTestId('form-error')).toHaveTextContent('unreachable');
  });

  it('offers delete only when the page provides a handler', () => {
    renderForm({ onDelete: vi.fn() });

    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument();
  });

  // Any in-flight write disables every action, so a double submit or a
  // save-then-delete race is impossible.
  it.each([
    ['saving', { isSaving: true }, 'Saving…'],
    ['deleting', { isDeleting: true }, 'Deleting…'],
  ])('disables every action while %s', (_label, props, busyLabel) => {
    renderForm({ ...props, onDelete: vi.fn() });

    expect(screen.getByText(busyLabel)).toBeInTheDocument();
    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeDisabled();
    }
  });
});
