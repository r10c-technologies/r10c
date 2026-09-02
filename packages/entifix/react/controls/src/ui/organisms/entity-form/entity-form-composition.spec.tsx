import {
  accessor,
  type Entity,
  entity,
  type EntityDraft,
  type EntityId,
  ROW_KEY,
} from '@r10c/entifix-ts-core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { EntityForm } from './entity-form';

class OrderLine {
  #sku = '';
  #quantity = 0;

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
}

@entity({ key: 'composed-order' })
class ComposedOrder implements Entity {
  #id?: EntityId;
  #reference = '';
  #lines: readonly OrderLine[] = [];
  #note = '';

  @accessor({ type: 'id', label: 'ID', hidden: true })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'string', label: 'Referencia', order: 1 })
  get reference(): string {
    return this.#reference;
  }
  set reference(value: string) {
    this.#reference = value;
  }

  /**
   * Declared **between** the two scalars on purpose: the grid must still land
   * below both, because the partition is not an ordering hint.
   */
  @accessor({
    type: 'composition',
    childType: () => OrderLine,
    label: 'Líneas',
    order: 2,
  })
  get lines(): readonly OrderLine[] {
    return this.#lines;
  }
  set lines(value: readonly OrderLine[]) {
    this.#lines = value;
  }

  @accessor({ type: 'string', label: 'Nota', order: 3 })
  get note(): string {
    return this.#note;
  }
  set note(value: string) {
    this.#note = value;
  }
}

/** A composition that named no child — there is nothing for a grid to draw. */
@entity({ key: 'bare-order' })
class BareOrder implements Entity {
  #id?: EntityId;
  #lines: readonly OrderLine[] = [];

  @accessor({ type: 'id', label: 'ID', hidden: true })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'composition', label: 'Líneas' })
  get lines(): readonly OrderLine[] {
    return this.#lines;
  }
  set lines(value: readonly OrderLine[]) {
    this.#lines = value;
  }
}

const draft = (rows: unknown = []): EntityDraft => ({
  reference: 'A-1',
  note: 'urgente',
  lines: rows as EntityDraft[keyof EntityDraft],
});

const ROWS = [{ [ROW_KEY]: 'k1', sku: 'SPR-001', quantity: '2' }];

describe('EntityForm — an entity that owns rows', () => {
  it('renders the grid from metadata alone, with no per-entity code', () => {
    render(
      <EntityForm<ComposedOrder>
        entityConstructor={ComposedOrder}
        values={draft(ROWS)}
        mode="edit"
      />,
    );

    expect(screen.getByRole('table')).toHaveAccessibleName('Líneas');
    expect(screen.getByDisplayValue('SPR-001')).toBeInTheDocument();
  });

  it('puts the grid below every field, whatever order it declared', () => {
    // Form above, table below. A grid between two labelled inputs reads as a
    // field, which it is not — it is a second record list.
    render(
      <EntityForm<ComposedOrder>
        entityConstructor={ComposedOrder}
        values={draft(ROWS)}
        mode="edit"
      />,
    );

    const table = screen.getByRole('table');
    const note = screen.getByLabelText('Nota');
    expect(
      note.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('writes an edited row back through onFieldChange', async () => {
    const user = userEvent.setup();
    const onFieldChange = vi.fn();
    render(
      <EntityForm<ComposedOrder>
        entityConstructor={ComposedOrder}
        values={draft(ROWS)}
        onFieldChange={onFieldChange}
        mode="edit"
      />,
    );

    await user.type(screen.getByLabelText('Cantidad'), '5');

    expect(onFieldChange).toHaveBeenCalledWith('lines', [
      expect.objectContaining({ quantity: '25' }),
    ]);
  });

  it('hands the grid its own row errors and nothing else', () => {
    render(
      <EntityForm<ComposedOrder>
        entityConstructor={ComposedOrder}
        values={draft(ROWS)}
        errors={{
          reference: 'Referencia es obligatoria',
          'lines[0].sku': 'SKU es obligatorio',
        }}
        mode="edit"
      />,
    );

    expect(screen.getByText('SKU es obligatorio')).toBeInTheDocument();
    // The field's own message still belongs to the field row, not the grid.
    expect(screen.getByText('Referencia es obligatoria')).toBeInTheDocument();
  });

  it('reads an unreadable draft value as no rows', () => {
    // A draft written before the member existed, or restored from a build that
    // did not carry row keys.
    render(
      <EntityForm<ComposedOrder>
        entityConstructor={ComposedOrder}
        values={draft('')}
        mode="edit"
      />,
    );

    expect(screen.getByText('Todavía no hay filas.')).toBeInTheDocument();
  });

  it('holds the grid’s shape while the record is in flight', () => {
    render(
      <EntityForm<ComposedOrder> entityConstructor={ComposedOrder} isLoading />,
    );

    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true');
  });

  it('shows the rows read-only outside edit mode', () => {
    render(
      <EntityForm<ComposedOrder>
        entityConstructor={ComposedOrder}
        values={draft(ROWS)}
        mode="read"
      />,
    );

    expect(screen.getByText('SPR-001')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Añadir fila' }),
    ).not.toBeInTheDocument();
  });

  it('leaves a composition with no declared child in the field stack', () => {
    // It reads as its row count, exactly as it did before the grid existed —
    // an honest "some rows" rather than an empty table implying there are none.
    render(
      <EntityForm<BareOrder>
        entityConstructor={BareOrder}
        values={{ lines: '' }}
        mode="edit"
      />,
    );

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('Líneas')).toBeInTheDocument();
  });

  it('still refuses a link source aimed at an owned collection', () => {
    // A picker looks up records that already exist; owned rows never do.
    expect(() =>
      render(
        <EntityForm<ComposedOrder>
          entityConstructor={ComposedOrder}
          values={draft(ROWS)}
          linkSources={{
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            lines: {} as any,
          }}
        />,
      ),
    ).toThrow(/owned collection/);
  });
});
