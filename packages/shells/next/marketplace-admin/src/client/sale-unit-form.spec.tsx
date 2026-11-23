import { ProductOffering } from '@r10c/business-ts-product-configuration-management';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SALE_UNIT_FORM, SaleUnitForm } from './sale-unit-form.js';

const offering = (revision?: number) =>
  Object.assign(new ProductOffering('Cable', 'spec-1'), {
    id: 'o-1',
    ...(revision === undefined ? {} : { revision }),
  });

const renderForm = (record: ProductOffering, submit = vi.fn()) => {
  render(
    <>
      <SaleUnitForm record={record} formId="unit-form" submit={submit} />
      <button type="submit" form="unit-form">
        Send
      </button>
    </>,
  );
  return submit;
};

describe('SaleUnitForm', () => {
  it('is the form set-sale-unit names', () => {
    expect(SALE_UNIT_FORM).toBe('sale-unit');
  });

  it('offers every unit by its name, starting at the offering’s own', () => {
    renderForm(offering(3));

    const select = screen.getByRole('combobox', { name: 'Unidad de venta' });
    expect(select).toHaveValue('UN');
    expect(screen.getByRole('option', { name: 'Metro' })).toBeInTheDocument();
    expect(
      screen.getByText(/vuelven a una unidad completa/),
    ).toBeInTheDocument();
  });

  it('submits the unit with the revision the vendor is looking at', async () => {
    const submit = renderForm(offering(3));

    await userEvent.selectOptions(
      screen.getByRole('combobox', { name: 'Unidad de venta' }),
      'M',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(submit).toHaveBeenCalledWith({ saleUnit: 'M', revision: 3 });
  });

  it('names no revision for a seeded offering that has none yet', async () => {
    const submit = renderForm(offering());

    await userEvent.click(screen.getByRole('button', { name: 'Send' }));

    expect(submit).toHaveBeenCalledWith({ saleUnit: 'UN' });
  });
});
