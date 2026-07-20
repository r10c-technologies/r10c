import {
  accessor,
  describeEntityColumns,
  type Entity,
  entity,
  type EntityId,
} from '@r10c/entifix-ts-core';

import type { EntityTableColumn } from './entity-table.types';
import {
  EntityColumn,
  EntityTableHeader,
  EntityTableRow,
  EntityTableToolbar,
  readEntityTableSlots,
} from './entity-table-slots';
import { resolveEntityTableColumns } from './use-entity-table-columns';

@entity({ key: 'gadget' })
class Gadget implements Entity {
  #id?: EntityId;
  #code?: string;
  #name?: string;

  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'string', label: 'Code' })
  get code(): string | undefined {
    return this.#code;
  }
  set code(value: string | undefined) {
    this.#code = value;
  }

  @accessor({ type: 'string', label: 'Name' })
  get name(): string | undefined {
    return this.#name;
  }
  set name(value: string | undefined) {
    this.#name = value;
  }
}

const described = () =>
  describeEntityColumns(Gadget) as Array<EntityTableColumn<Gadget>>;
const names = (columns: Array<EntityTableColumn<Gadget>>) =>
  columns.map(column => column.name);

describe('resolveEntityTableColumns', () => {
  it('defaults to the metadata columns in declaration order', () => {
    const { columns, visibleColumns } = resolveEntityTableColumns<Gadget>(
      described(),
      [],
      {},
    );
    expect(names(columns)).toEqual(['id', 'code', 'name']);
    expect(names(visibleColumns)).toEqual(['id', 'code', 'name']);
  });

  it('applies a slot override without changing the column set', () => {
    const { columns } = resolveEntityTableColumns<Gadget>(
      described(),
      [{ field: 'code', label: 'SKU' }],
      {},
    );
    expect(names(columns)).toEqual(['id', 'code', 'name']);
    expect(columns.find(column => column.name === 'code')?.label).toBe('SKU');
  });

  it('appends a slot column the entity has no member for', () => {
    const { columns } = resolveEntityTableColumns<Gadget>(
      described(),
      [{ field: 'margin', label: 'Margin', type: 'number' }],
      {},
    );
    const margin = columns.find(column => column.name === 'margin');
    expect(margin).toMatchObject({
      label: 'Margin',
      type: 'number',
      virtual: true,
    });
  });

  it('reorders per the stored personalization', () => {
    const { columns } = resolveEntityTableColumns<Gadget>(described(), [], {
      order: ['name', 'code', 'id'],
    });
    expect(names(columns)).toEqual(['name', 'code', 'id']);
  });

  it('keeps columns missing from a stored order, at the end', () => {
    // A member added to the entity after the layout was saved must still show.
    const { columns } = resolveEntityTableColumns<Gadget>(described(), [], {
      order: ['name'],
    });
    expect(names(columns)).toEqual(['name', 'id', 'code']);
  });

  it('ignores stale names in a stored order', () => {
    const { columns } = resolveEntityTableColumns<Gadget>(described(), [], {
      order: ['removed', 'name'],
    });
    expect(names(columns)).toEqual(['name', 'id', 'code']);
  });

  it('drops hidden columns from the visible set only', () => {
    const { columns, visibleColumns, hidden } =
      resolveEntityTableColumns<Gadget>(described(), [], { hidden: ['id'] });
    expect(names(columns)).toContain('id');
    expect(names(visibleColumns)).toEqual(['code', 'name']);
    expect(hidden).toEqual(['id']);
  });
});

describe('readEntityTableSlots', () => {
  it('sorts children by component identity and keeps the rest', () => {
    const slots = readEntityTableSlots<Gadget>([
      <EntityColumn<Gadget> key="a" field="code" label="SKU" />,
      <EntityColumn<Gadget> key="b" field="name" />,
      <EntityTableHeader<Gadget> key="h" render={() => null} />,
      <EntityTableRow<Gadget> key="r" render={() => null} />,
      <EntityTableToolbar key="t">
        <span>export</span>
      </EntityTableToolbar>,
      <p key="p">footnote</p>,
    ]);

    expect(slots.columns.map(column => column.field)).toEqual(['code', 'name']);
    expect(slots.header).toBeDefined();
    expect(slots.row).toBeDefined();
    expect(slots.toolbar).toBeDefined();
    expect(slots.rest).toHaveLength(1);
  });

  it('treats a table with no children as fully metadata-driven', () => {
    const slots = readEntityTableSlots<Gadget>(undefined);
    expect(slots.columns).toEqual([]);
    expect(slots.header).toBeUndefined();
    expect(slots.rest).toEqual([]);
  });
});
