import {
  accessor,
  describeEntityColumns,
  type Entity,
  entity,
  type EntityFieldDescriptor,
  type EntityId,
  type EntityRowDraft,
  ROW_KEY,
} from '@r10c/entifix-ts-core';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { EntityDetailGrid } from './entity-detail-grid.js';

class Line {
  #sku = '';
  #quantity = 0;
  #unit = 'unit';
  #total = 0;
  #parts: readonly Line[] = [];

  @accessor({ type: 'string', label: 'SKU' })
  get sku(): string {
    return this.#sku;
  }
  set sku(value: string) {
    this.#sku = value;
  }

  @accessor({ type: 'number', label: 'Cantidad' })
  get quantity(): number {
    return this.#quantity;
  }
  set quantity(value: number) {
    this.#quantity = value;
  }

  @accessor({ type: 'enum', label: 'Unidad', enumValues: ['unit', 'box'] })
  get unit(): string {
    return this.#unit;
  }
  set unit(value: string) {
    this.#unit = value;
  }

  /** Server-owned: a column the grid shows and never writes. */
  @accessor({ type: 'number', label: 'Total', readonly: true })
  get total(): number {
    return this.#total;
  }
  set total(value: number) {
    this.#total = value;
  }

  /** A nested collection: dropped, because a grid inside a grid is not built. */
  @accessor({ type: 'composition', childType: () => Line, label: 'Partes' })
  get parts(): readonly Line[] {
    return this.#parts;
  }
  set parts(value: readonly Line[]) {
    this.#parts = value;
  }
}

@entity({ key: 'spec-order' })
class Order implements Entity {
  #id?: EntityId;
  #lines: readonly Line[] = [];
  #bare: readonly Line[] = [];

  @accessor({ type: 'id', label: 'ID' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'composition', childType: () => Line, label: 'Líneas' })
  get lines(): readonly Line[] {
    return this.#lines;
  }
  set lines(value: readonly Line[]) {
    this.#lines = value;
  }

  /** A composition that names no child — nothing for a grid to draw. */
  @accessor({ type: 'composition', label: 'Sin declarar' })
  get bare(): readonly Line[] {
    return this.#bare;
  }
  set bare(value: readonly Line[]) {
    this.#bare = value;
  }
}

const columnFor = (name: string): EntityFieldDescriptor =>
  describeEntityColumns(Order).find(
    column => column.name === name,
  ) as EntityFieldDescriptor;

const LINES = columnFor('lines');
const BARE = columnFor('bare');

let keys = 0;
const row = (sku = '', quantity = '', unit = 'unit'): EntityRowDraft => ({
  [ROW_KEY]: `k${++keys}`,
  sku,
  quantity,
  unit,
  total: '0',
});

const renderGrid = (props: Partial<Parameters<typeof EntityDetailGrid>[0]>) => {
  const onRowsChange = vi.fn();
  render(
    <EntityDetailGrid
      descriptor={LINES}
      rows={[]}
      onRowsChange={onRowsChange}
      editing
      {...props}
    />,
  );
  return { onRowsChange };
};

describe('EntityDetailGrid', () => {
  it('takes its columns from the child, not from the master', () => {
    renderGrid({ rows: [row('A', '2')] });

    expect(
      screen.getAllByRole('columnheader').map(header => header.textContent),
    ).toEqual(['SKU', 'Cantidad', 'Unidad', 'Total', 'Acciones de fila']);
  });

  it('drops a nested collection from the columns', () => {
    // One level deep by decision: `reconstructChild` does not rebuild a child's
    // own rows, so offering a column for them would promise an edit that never
    // reaches the record.
    renderGrid({ rows: [row()] });

    expect(screen.queryByText('Partes')).not.toBeInTheDocument();
  });

  it('names the grid after the owning member', () => {
    renderGrid({ rows: [] });

    expect(screen.getByRole('table')).toHaveAccessibleName('Líneas');
  });

  it('renders a message row when there are no rows', () => {
    renderGrid({ rows: [] });

    expect(screen.getByText('Todavía no hay filas.')).toBeInTheDocument();
  });

  it('renders no columns for a composition that declared no child', () => {
    render(
      <EntityDetailGrid
        descriptor={BARE}
        rows={[]}
        onRowsChange={vi.fn()}
        editing
      />,
    );

    expect(screen.getByText('Todavía no hay filas.')).toBeInTheDocument();
  });

  describe('editing', () => {
    it('writes a cell edit back as a new row list', async () => {
      const user = userEvent.setup();
      const { onRowsChange } = renderGrid({ rows: [row('A', '2')] });

      await user.type(screen.getByLabelText('SKU'), 'B');

      expect(onRowsChange).toHaveBeenCalledWith([
        expect.objectContaining({ sku: 'AB' }),
      ]);
    });

    it('labels each cell by its column header', () => {
      // A cell has no label of its own; the header is the label and the row is
      // the subject, which is why the control takes `aria-labelledby`.
      renderGrid({ rows: [row('A', '2')] });

      expect(screen.getByLabelText('Cantidad')).toHaveValue(2);
    });

    it('appends a row through the add action', async () => {
      const user = userEvent.setup();
      const { onRowsChange } = renderGrid({ rows: [row('A', '2')] });

      await user.click(screen.getByRole('button', { name: 'Añadir fila' }));

      expect(onRowsChange).toHaveBeenCalledWith([
        expect.objectContaining({ sku: 'A' }),
        expect.objectContaining({ sku: '', quantity: '', unit: '' }),
      ]);
    });

    it('seeds a new row with every column, never with absent members', async () => {
      // A control handed `undefined` flips from controlled to uncontrolled the
      // moment the user types into it.
      const user = userEvent.setup();
      const { onRowsChange } = renderGrid({ rows: [] });

      await user.click(screen.getByRole('button', { name: 'Añadir fila' }));

      const [added] = onRowsChange.mock.calls[0]?.[0] as EntityRowDraft[];
      expect(Object.keys(added ?? {}).sort()).toEqual([
        ROW_KEY,
        'quantity',
        'sku',
        'total',
        'unit',
      ]);
    });

    it('gives every added row a distinct key', async () => {
      const user = userEvent.setup();
      const { onRowsChange } = renderGrid({ rows: [row('A')] });

      await user.click(screen.getByRole('button', { name: 'Añadir fila' }));

      const rows = onRowsChange.mock.calls[0]?.[0] as EntityRowDraft[];
      expect(rows[1]?.[ROW_KEY]).not.toBe(rows[0]?.[ROW_KEY]);
    });

    it('appends a row on Enter anywhere in the last row', async () => {
      const user = userEvent.setup();
      const { onRowsChange } = renderGrid({ rows: [row('A', '2')] });

      await user.click(screen.getByLabelText('SKU'));
      await user.keyboard('{Enter}');

      expect(onRowsChange).toHaveBeenCalledTimes(1);
    });

    it('does not append from a row that is not the last', async () => {
      const user = userEvent.setup();
      const { onRowsChange } = renderGrid({ rows: [row('A'), row('B')] });

      await user.click(screen.getAllByLabelText('SKU')[0] as HTMLElement);
      await user.keyboard('{Enter}');

      expect(onRowsChange).not.toHaveBeenCalled();
    });

    it('leaves Enter alone in a select, which opens on it', async () => {
      // Taking the key here would break the control's own behaviour to add a
      // row the user never asked for.
      const user = userEvent.setup();
      const { onRowsChange } = renderGrid({ rows: [row('A')] });

      await user.click(screen.getByLabelText('Unidad'));
      await user.keyboard('{Enter}');

      expect(onRowsChange).not.toHaveBeenCalled();
    });

    it('leaves Enter alone in a read-only cell', async () => {
      // The last column is whatever the child declared last, and a computed
      // member there is a disabled input — the reason the binding is on the row.
      const user = userEvent.setup();
      const { onRowsChange } = renderGrid({ rows: [row('A')] });

      screen.getByLabelText('Total').focus();
      await user.keyboard('{Enter}');

      expect(onRowsChange).not.toHaveBeenCalled();
    });

    it('removes the row its action names', async () => {
      const user = userEvent.setup();
      const first = row('A');
      const second = row('B');
      const { onRowsChange } = renderGrid({ rows: [first, second] });

      await user.click(screen.getByRole('button', { name: 'Quitar fila 1' }));

      expect(onRowsChange).toHaveBeenCalledWith([second]);
    });

    it('edits one row and leaves its siblings identical', async () => {
      const user = userEvent.setup();
      const first = row('A', '1');
      const second = row('B', '2');
      const { onRowsChange } = renderGrid({ rows: [first, second] });

      await user.type(screen.getAllByLabelText('SKU')[1] as HTMLElement, 'X');

      expect(onRowsChange).toHaveBeenCalledWith([
        first,
        expect.objectContaining({ sku: 'BX' }),
      ]);
    });

    it('ignores a key that is not Enter in the last row', async () => {
      const user = userEvent.setup();
      const { onRowsChange } = renderGrid({ rows: [row('A')] });

      await user.click(screen.getByLabelText('SKU'));
      await user.keyboard('{Escape}');

      expect(onRowsChange).not.toHaveBeenCalled();
    });

    it('renders a row missing a member as empty rather than crashing', async () => {
      // A row restored from a draft written before the child gained a member
      // has no entry for it. It must read as an empty cell, not flip the
      // control from controlled to uncontrolled.
      const user = userEvent.setup();
      const { onRowsChange } = renderGrid({
        rows: [{ [ROW_KEY]: 'k0', sku: 'A' }],
      });

      expect(screen.getByLabelText('Cantidad')).toHaveValue(null);

      await user.type(screen.getByLabelText('Cantidad'), '7');

      expect(onRowsChange).toHaveBeenCalledWith([
        expect.objectContaining({ quantity: '7' }),
      ]);
    });

    it('renders a missing member as empty in read mode too', () => {
      renderGrid({ rows: [{ [ROW_KEY]: 'k0', sku: 'A' }], editing: false });

      expect(screen.getByText('A')).toBeInTheDocument();
    });

    it('removes the only row without stealing focus anywhere', async () => {
      // There is no cell left to land in, so focus stays where the user put it
      // rather than jumping to an arbitrary control.
      const user = userEvent.setup();
      const { onRowsChange } = renderGrid({ rows: [row('A')] });

      await user.click(screen.getByRole('button', { name: 'Quitar fila 1' }));

      expect(onRowsChange).toHaveBeenCalledWith([]);
    });

    it('offers no row controls in read mode', () => {
      renderGrid({ rows: [row('A')], editing: false });

      expect(
        screen.queryByRole('button', { name: 'Añadir fila' }),
      ).not.toBeInTheDocument();
      expect(screen.getByText('A')).toBeInTheDocument();
    });
  });

  describe('errors', () => {
    const errors = {
      'lines[1].quantity': 'Cantidad debe ser un número',
      // Another member's row error, which this grid must ignore.
      'other[0].sku': 'No es de esta rejilla',
      // A top-level field's error, which is not a row path at all.
      reference: 'Referencia es obligatoria',
    };

    it('puts a message in the cell that caused it', () => {
      renderGrid({ rows: [row('A'), row('B', 'x')], errors });

      const rows = screen.getAllByRole('row');
      expect(
        within(rows[2] as HTMLElement).getByText('Cantidad debe ser un número'),
      ).toBeInTheDocument();
    });

    it('marks the failing cell invalid and points it at its message', () => {
      renderGrid({ rows: [row('A'), row('B', 'x')], errors });

      const cells = screen.getAllByLabelText('Cantidad');
      expect(cells[1]).toHaveAttribute('aria-invalid', 'true');
      expect(cells[1]).toHaveAccessibleDescription(
        'Cantidad debe ser un número',
      );
      expect(cells[0]).not.toHaveAttribute('aria-invalid');
    });

    it('summarizes the failures in the one live region', () => {
      // A `role="alert"` per cell would announce the whole grid on every
      // keystroke; one summary is what makes a scrolled-out row findable.
      renderGrid({ rows: [row('A'), row('B', 'x')], errors });

      expect(screen.getByRole('alert')).toHaveTextContent(
        '1 celda con errores',
      );
    });

    it('ignores messages naming another member’s rows', () => {
      renderGrid({ rows: [row('A'), row('B', 'x')], errors });

      expect(
        screen.queryByText('No es de esta rejilla'),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText('Referencia es obligatoria'),
      ).not.toBeInTheDocument();
    });

    it('shows no messages in read mode', () => {
      renderGrid({ rows: [row('A'), row('B', 'x')], errors, editing: false });

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('shows no summary when nothing failed', () => {
      renderGrid({ rows: [row('A')], errors: {} });

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('reads an absent error map as no failures', () => {
      renderGrid({ rows: [row('A')] });

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });
  });

  describe('loading', () => {
    it('replaces the rows with a placeholder of its own column count', () => {
      renderGrid({ rows: [], isLoading: true });

      expect(screen.getAllByTestId('skeleton')).toHaveLength(15);
      expect(
        screen.queryByText('Todavía no hay filas.'),
      ).not.toBeInTheDocument();
    });

    it('marks the region busy rather than announcing each placeholder', () => {
      renderGrid({ rows: [], isLoading: true });

      expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true');
    });

    it('renders a supplied node instead of the default placeholder', () => {
      renderGrid({
        rows: [],
        isLoading: true,
        skeleton: (
          <tr>
            <td>Cargando líneas</td>
          </tr>
        ),
      });

      expect(screen.getByText('Cargando líneas')).toBeInTheDocument();
      expect(screen.queryByTestId('skeleton')).not.toBeInTheDocument();
    });

    it('draws no action column in the placeholder when not editing', () => {
      renderGrid({ rows: [], isLoading: true, editing: false });

      expect(screen.getAllByTestId('skeleton')).toHaveLength(12);
    });

    it('renders no placeholder at all when asked for none', () => {
      renderGrid({ rows: [], isLoading: true, skeleton: false });

      expect(screen.queryByTestId('skeleton')).not.toBeInTheDocument();
      expect(screen.getByText('Todavía no hay filas.')).toBeInTheDocument();
    });
  });

  describe('footer', () => {
    it('renders the aggregate it is handed', () => {
      renderGrid({
        rows: [row('A', '2'), row('B', '3')],
        footer: rows => (
          <span>
            {rows.reduce(
              (total, line) => total + Number(line['quantity'] ?? 0),
              0,
            )}
          </span>
        ),
      });

      expect(screen.getByText('5')).toBeInTheDocument();
    });

    it('holds the aggregate back while the rows are still loading', () => {
      renderGrid({
        rows: [],
        isLoading: true,
        footer: () => <span>Suma de líneas</span>,
      });

      expect(screen.queryByText('Suma de líneas')).not.toBeInTheDocument();
    });
  });
});
