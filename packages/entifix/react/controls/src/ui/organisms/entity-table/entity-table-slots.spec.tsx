import type { Entity } from '@r10c/entifix-ts-core';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  EntityColumn,
  EntityTableHeader,
  EntityTableRow,
  EntityTableToolbar,
  readEntityTableSlots,
} from './entity-table-slots.js';

interface Widget extends Entity {
  name: string;
}

describe('the slot components', () => {
  // Slots are configuration expressed as JSX — `EntityTable` reads their props
  // and decides where the configuration applies. Rendering one directly must
  // produce nothing at all.
  it.each([
    ['EntityColumn', <EntityColumn key="c" field="name" />],
    ['EntityTableHeader', <EntityTableHeader key="h" render={() => null} />],
    ['EntityTableRow', <EntityTableRow key="r" render={() => null} />],
    ['EntityTableToolbar', <EntityTableToolbar key="t" />],
  ])('%s renders nothing on its own', (_label, element) => {
    const { container } = render(<div>{element}</div>);

    expect(container.firstElementChild).toBeEmptyDOMElement();
  });
});

describe('readEntityTableSlots', () => {
  it('returns empty slots for no children', () => {
    expect(readEntityTableSlots<Widget>(undefined)).toEqual({
      columns: [],
      rest: [],
    });
  });

  it('collects every column slot in order', () => {
    const slots = readEntityTableSlots<Widget>([
      <EntityColumn key="name" field="name" label="Name" />,
      <EntityColumn key="stock" field="stock" order={2} />,
    ]);

    expect(slots.columns.map((column) => column.field)).toEqual(['name', 'stock']);
    expect(slots.columns[0]?.label).toBe('Name');
  });

  it('captures the header and row renderers', () => {
    const header = () => null;
    const row = () => null;

    const slots = readEntityTableSlots<Widget>([
      <EntityTableHeader key="h" render={header} />,
      <EntityTableRow key="r" render={row} />,
    ]);

    expect(slots.header?.render).toBe(header);
    expect(slots.row?.render).toBe(row);
  });

  it('unwraps the toolbar’s children rather than the slot itself', () => {
    const slots = readEntityTableSlots<Widget>(
      <EntityTableToolbar>
        <button type="button">Export</button>
      </EntityTableToolbar>,
    );

    expect(slots.toolbar).toBeDefined();
    expect(slots.rest).toEqual([]);
  });

  it('keeps the last of a repeated single-value slot', () => {
    const second = () => null;

    const slots = readEntityTableSlots<Widget>([
      <EntityTableRow key="a" render={() => null} />,
      <EntityTableRow key="b" render={second} />,
    ]);

    expect(slots.row?.render).toBe(second);
  });

  // Anything that is not a slot is passed through untouched, so a caller can
  // put arbitrary markup inside the table's children without it disappearing.
  it('passes unrecognised elements through', () => {
    const slots = readEntityTableSlots<Widget>([
      <EntityColumn key="c" field="name" />,
      <p key="p">A note</p>,
    ]);

    expect(slots.columns).toHaveLength(1);
    expect(slots.rest).toHaveLength(1);
  });

  it('passes non-element children through', () => {
    const slots = readEntityTableSlots<Widget>('plain text');

    expect(slots.rest).toEqual(['plain text']);
  });

  // Matching is by component identity, not `displayName`: identity survives
  // minification and cannot collide with an unrelated component of the same
  // name.
  it('does not match a look-alike component by name', () => {
    function EntityColumnImpostor() {
      return null;
    }
    Object.defineProperty(EntityColumnImpostor, 'name', { value: 'EntityColumn' });

    const slots = readEntityTableSlots<Widget>(<EntityColumnImpostor />);

    expect(slots.columns).toEqual([]);
    expect(slots.rest).toHaveLength(1);
  });
});
