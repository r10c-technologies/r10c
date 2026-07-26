import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_PAGE_SIZE_OPTIONS, Pagination } from './pagination.js';

const renderPagination = (
  props: Partial<Parameters<typeof Pagination>[0]> = {},
) => {
  const onPageChange = vi.fn();
  const view = render(
    <Pagination
      currentPage={2}
      pageSize={10}
      totalItems={35}
      onPageChange={onPageChange}
      {...props}
    />,
  );
  return { ...view, onPageChange };
};

describe('Pagination', () => {
  it('reports the current page, the total pages and the item count', () => {
    renderPagination();

    expect(screen.getByText(/Página 2 de 4 · 35 registros/)).toBeInTheDocument();
  });

  // An empty listing is still one page; reporting "page 1 of 0" reads as broken.
  it('reports a single page when there is nothing to show', () => {
    renderPagination({ currentPage: 1, totalItems: 0 });

    expect(screen.getByText(/Página 1 de 1 · 0 registros/)).toBeInTheDocument();
  });

  it('steps backwards', async () => {
    const user = userEvent.setup();
    const { onPageChange } = renderPagination();

    await user.click(screen.getByRole('button', { name: 'Anterior' }));

    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it('steps forwards', async () => {
    const user = userEvent.setup();
    const { onPageChange } = renderPagination();

    await user.click(screen.getByRole('button', { name: 'Siguiente' }));

    expect(onPageChange).toHaveBeenCalledWith(3);
  });

  it('disables Previous on the first page', () => {
    renderPagination({ currentPage: 1 });

    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeEnabled();
  });

  it('disables Next on the last page', () => {
    renderPagination({ currentPage: 4 });

    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeEnabled();
  });

  it('disables both when there is a single page', () => {
    renderPagination({ currentPage: 1, totalItems: 3 });

    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
  });

  describe('the page-size selector', () => {
    // It is optional: a listing whose size is fixed by its caller should not
    // show a control that cannot do anything.
    it('is absent unless a handler is given', () => {
      renderPagination();

      expect(screen.queryByLabelText('Filas')).not.toBeInTheDocument();
    });

    it('offers the default options', () => {
      renderPagination({ onPageSizeChange: vi.fn() });

      for (const option of DEFAULT_PAGE_SIZE_OPTIONS) {
        expect(
          screen.getByRole('option', { name: String(option) }),
        ).toBeInTheDocument();
      }
    });

    it('offers caller-supplied options instead', () => {
      renderPagination({ onPageSizeChange: vi.fn(), pageSizeOptions: [5, 15] });

      expect(screen.getByRole('option', { name: '5' })).toBeInTheDocument();
      expect(screen.queryByRole('option', { name: '10' })).not.toBeInTheDocument();
    });

    it('shows the active page size', () => {
      renderPagination({ onPageSizeChange: vi.fn(), pageSize: 25 });

      expect(screen.getByLabelText('Filas')).toHaveValue('25');
    });

    // The select's value is a string; handing that to a caller expecting a
    // number is how `pageSize` ends up concatenated into a query string.
    it('reports the chosen size as a number', async () => {
      const user = userEvent.setup();
      const onPageSizeChange = vi.fn();
      renderPagination({ onPageSizeChange });

      await user.selectOptions(screen.getByLabelText('Filas'), '25');

      expect(onPageSizeChange).toHaveBeenCalledWith(25);
    });
  });

  it('keeps the caller’s className', () => {
    const { container } = renderPagination({ className: 'custom' });

    expect(container.firstElementChild?.className).toContain('custom');
  });
});
