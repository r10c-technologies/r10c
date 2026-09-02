import {
  accessor,
  describeEntityColumns,
  type Entity,
  entity,
  type EntityId,
  type EntityRowDraft,
  newRowKey,
} from '@r10c/entifix-ts-core';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { EntityDetailGrid } from './entity-detail-grid';

/**
 * A composition child: `@accessor()` and nothing else. No `@entity()`, no id —
 * a line has no life outside the order that holds it, which is the whole
 * distinction between a composition and a `linkCollection`.
 */
class StoryLine {
  #sku = '';
  #quantity = 0;
  #unit = 'unit';
  #shipped = false;

  @accessor({ type: 'string', label: 'SKU' })
  get sku(): string {
    return this.#sku;
  }
  set sku(value: string) {
    this.#sku = value;
  }

  @accessor({ type: 'number', label: 'Quantity' })
  get quantity(): number {
    return this.#quantity;
  }
  set quantity(value: number) {
    this.#quantity = value;
  }

  @accessor({ type: 'enum', label: 'Unit', enumValues: ['unit', 'box', 'kg'] })
  get unit(): string {
    return this.#unit;
  }
  set unit(value: string) {
    this.#unit = value;
  }

  @accessor({ type: 'boolean', label: 'Shipped' })
  get shipped(): boolean {
    return this.#shipped;
  }
  set shipped(value: boolean) {
    this.#shipped = value;
  }
}

@entity({ key: 'story-order' })
class StoryOrder implements Entity {
  #id?: EntityId;
  #lines: readonly StoryLine[] = [];

  @accessor({ type: 'id', label: 'ID' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'composition', childType: () => StoryLine, label: 'Lines' })
  get lines(): readonly StoryLine[] {
    return this.#lines;
  }
  set lines(value: readonly StoryLine[]) {
    this.#lines = value;
  }
}

/** The owning member's descriptor is the grid's whole configuration. */
const LINES = describeEntityColumns(StoryOrder).find(
  column => column.name === 'lines',
) as ReturnType<typeof describeEntityColumns>[number];

const row = (
  sku: string,
  quantity: string,
  unit: string,
  shipped: string,
): EntityRowDraft => ({
  $key: newRowKey(),
  sku,
  quantity,
  unit,
  shipped,
});

const ROWS = [
  row('SPR-001', '12', 'box', 'true'),
  row('SPR-002', '4', 'unit', ''),
  row('BLT-330', '25', 'kg', ''),
];

function Demo({
  initial = ROWS,
  editing = true,
  errors,
  footer,
}: {
  initial?: EntityRowDraft[];
  editing?: boolean;
  errors?: Record<string, string>;
  footer?: boolean;
}) {
  const [rows, setRows] = useState<readonly EntityRowDraft[]>(initial);

  return (
    <EntityDetailGrid
      descriptor={LINES}
      rows={rows}
      onRowsChange={setRows}
      editing={editing}
      errors={errors}
      footer={
        footer
          ? current => (
              <span>
                {current.reduce(
                  (total, line) => total + Number(line['quantity'] ?? 0),
                  0,
                )}
              </span>
            )
          : undefined
      }
    />
  );
}

const meta = {
  title: 'Organisms/EntityDetailGrid',
  component: EntityDetailGrid,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof EntityDetailGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Inline cells. `Tab` walks a row and crosses into the next; `Enter` in the
 * last cell of the last row appends one and lands in its first cell.
 */
export const Default: Story = { render: () => <Demo /> };

/** Read mode: the rows as values, with no way to change them. */
export const Reading: Story = { render: () => <Demo editing={false} /> };

/** No rows yet — the create case, and the case where every row was removed. */
export const Empty: Story = { render: () => <Demo initial={[]} /> };

/**
 * The record is still in flight. Three placeholder rows of the grid's own
 * column count, so the swap to real rows shifts nothing.
 */
export const Loading: Story = {
  render: () => (
    <EntityDetailGrid
      descriptor={LINES}
      rows={[]}
      onRowsChange={() => undefined}
      editing
      isLoading
    />
  ),
};

/**
 * A cell carries its own message and `aria-invalid`; the summary above the grid
 * is the only live region, and it is what makes a failing row findable when it
 * is scrolled out of view.
 */
export const WithRowErrors: Story = {
  render: () => (
    <Demo
      errors={{
        'lines[1].quantity': 'Cantidad debe ser un número',
        'lines[2].sku': 'SKU es obligatorio',
      }}
    />
  ),
};

/**
 * The aggregate is a **slot**. Metadata cannot derive one: summing an amount in
 * minor units across currencies is wrong, and summing a quantity across
 * offerings means nothing — so the control renders what it is handed.
 */
export const WithFooterTotal: Story = { render: () => <Demo footer /> };
