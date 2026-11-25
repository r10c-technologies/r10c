import { extractMetaUseCaseBinding } from '@entifix/core';
import { ProductOffering } from '@r10c/business-ts-product-configuration-management';
import { SetVariantUC } from '@r10c/business-ts-product-configuration-management';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  nextAxis,
  VARIANT_FORM,
  VariantForm,
  variantPayloadOf,
} from './variant-form.js';

const sole = (overrides: Partial<ProductOffering> = {}) =>
  Object.assign(new ProductOffering('Suela de hule, talla 40', 'spec-1'), {
    id: 'sole',
    ...overrides,
  });

const renderForm = (record: ProductOffering, submit = vi.fn()) => {
  render(
    <>
      <VariantForm record={record} formId="variant-form" submit={submit} />
      <button type="submit" form="variant-form">
        Send
      </button>
    </>,
  );
  return submit;
};

describe('VariantForm', () => {
  it('is the form set-variant names', () => {
    expect(VARIANT_FORM).toBe('variant');
    expect(extractMetaUseCaseBinding(SetVariantUC).key).toBe('set-variant');
  });

  it('adds an attribute per row, the next one not yet taken', async () => {
    const submit = renderForm(sole({ revision: 4 }));
    expect(screen.getByTestId('variant-none')).toBeTruthy();

    const add = screen.getByRole('button', {
      name: /^(add an attribute|añadir atributo)$/i,
    });
    await userEvent.click(add);
    await userEvent.click(add);
    const values = screen.getAllByRole('textbox');
    await userEvent.type(values[0] as HTMLElement, ' negro ');
    await userEvent.type(values[1] as HTMLElement, '40');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(submit).toHaveBeenCalledWith({
      variantValues: [
        { axis: 'color', value: 'negro' },
        { axis: 'size', value: '40' },
      ],
      revision: 4,
    });
  });

  it('starts from the stored variant, and clears it when every row goes', async () => {
    const submit = renderForm(
      sole({ variantValues: [{ axis: 'color', value: 'café' }] }),
    );
    expect(screen.getByDisplayValue('café')).toBeTruthy();

    await userEvent.selectOptions(screen.getByRole('combobox'), 'finish');
    await userEvent.click(screen.getByRole('button', { name: /1/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(submit).toHaveBeenCalledWith({ variantValues: [] });
  });

  it('offers no fourth attribute', async () => {
    renderForm(
      sole({
        variantValues: [
          { axis: 'color', value: 'a' },
          { axis: 'size', value: 'b' },
          { axis: 'finish', value: 'c' },
        ],
      }),
    );

    expect(
      screen.queryByRole('button', {
        name: /^(add an attribute|añadir atributo)$/i,
      }),
    ).toBeNull();
  });
});

describe('the variant payload', () => {
  it('drops blank rows and trims values', () => {
    expect(
      variantPayloadOf([
        { axis: 'color', value: ' azul ' },
        { axis: 'size', value: '  ' },
      ]),
    ).toEqual([{ axis: 'color', value: 'azul' }]);
  });

  it('takes the first axis still free, and the first when all are', () => {
    expect(nextAxis([{ axis: 'color' }])).toBe('size');
    expect(
      nextAxis([
        { axis: 'color' },
        { axis: 'size' },
        { axis: 'finish' },
        { axis: 'capacity' },
      ]),
    ).toBe('color');
  });
});
