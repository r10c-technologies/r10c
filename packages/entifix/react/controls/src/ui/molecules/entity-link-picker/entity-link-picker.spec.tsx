import {
  accessor,
  type Entity,
  entity,
  type EntityFieldDescriptor,
  type EntityId,
  type EntityLinkSource,
} from '@r10c/entifix-ts-core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { EntityLinkPicker } from './entity-link-picker';

@entity({ key: 'picker-brand' })
class PickerBrand implements Entity {
  #id?: EntityId;
  #name?: string;

  constructor(id?: EntityId, name?: string) {
    this.#id = id;
    this.#name = name;
  }

  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'string' })
  get name(): string | undefined {
    return this.#name;
  }
  set name(value: string | undefined) {
    this.#name = value;
  }
}

const descriptor: EntityFieldDescriptor = {
  name: 'brand',
  key: 'brand',
  label: 'Brand',
  type: 'link',
  sortable: false,
  filterable: false,
  order: 0,
  readonly: false,
  required: false,
  linkLabelProperty: 'name',
  linkSearchProperty: 'name',
  linkSerialization: 'id',
  resetOnClone: false,
};

const ITEMS = [
  new PickerBrand('b-1', 'Acme'),
  new PickerBrand('b-2', 'Globex'),
];

function source(
  browse: Partial<EntityLinkSource<PickerBrand>['browse']> = {},
): EntityLinkSource<PickerBrand> {
  return {
    entityConstructor: PickerBrand,
    labelOf: target => target.name ?? '',
    selected: { isLoading: false },
    quick: {
      term: '',
      setTerm: vi.fn(),
      options: ITEMS,
      isLoading: false,
    },
    browse: {
      items: ITEMS,
      totalItems: ITEMS.length,
      currentPage: 1,
      pageSize: 10,
      isLoading: false,
      onPageChange: vi.fn(),
      onPageSizeChange: vi.fn(),
      onFilteringChange: vi.fn(),
      onSortingChange: vi.fn(),
      isOpen: true,
      open: vi.fn(),
      close: vi.fn(),
      ...browse,
    },
  };
}

describe('EntityLinkPicker', () => {
  it('renders nothing while closed', () => {
    render(
      <EntityLinkPicker
        descriptor={descriptor}
        source={source({ isOpen: false })}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('names the dialog after the relation and lists the targets', () => {
    render(
      <EntityLinkPicker
        descriptor={descriptor}
        source={source()}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Seleccionar Brand')).toBeInTheDocument();
    // Twice: the table renders a grid and a card list, and CSS picks one.
    expect(screen.getAllByText('Acme').length).toBeGreaterThan(0);
  });

  it('reports the row the user picked', async () => {
    const onSelect = vi.fn();
    render(
      <EntityLinkPicker
        descriptor={descriptor}
        source={source()}
        onSelect={onSelect}
      />,
    );

    await userEvent.click(
      screen.getAllByRole('button', { name: 'Seleccionar' })[0]!,
    );

    expect(onSelect).toHaveBeenCalledWith(ITEMS[0]);
  });

  it('closes on the explicit action', async () => {
    const picker = source();
    render(
      <EntityLinkPicker
        descriptor={descriptor}
        source={picker}
        onSelect={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));

    expect(picker.browse.close).toHaveBeenCalled();
  });

  // The dialog owns no request: paging and filtering are the source's, so the
  // table's controls have to reach it unchanged.
  it('forwards the table controls to the source', async () => {
    const picker = source({ totalItems: 40 });
    render(
      <EntityLinkPicker
        descriptor={descriptor}
        source={picker}
        onSelect={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }));

    expect(picker.browse.onPageChange).toHaveBeenCalledWith(2);
  });
});
