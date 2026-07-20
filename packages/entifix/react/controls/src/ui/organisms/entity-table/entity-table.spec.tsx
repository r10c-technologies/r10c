/**
 * @jest-environment jsdom
 */
import {
  accessor,
  type Entity,
  entity,
  type EntityId,
  EntityLink,
} from '@r10c/entifix-ts-core';
import { render, screen } from '@testing-library/react';

import { EntityTable } from './entity-table';
import { EntityColumn } from './entity-table-slots';

@entity({ key: 'widget-brand' })
class WidgetBrand implements Entity {
  #id?: EntityId;
  #name?: string;

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

@entity({ key: 'widget' })
class Widget implements Entity {
  #id?: EntityId;
  #name?: string;
  #stock = 0;
  #brand = new EntityLink(WidgetBrand);

  @accessor({ type: 'id', label: 'ID' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'string', label: 'Name' })
  get name(): string | undefined {
    return this.#name;
  }
  set name(value: string | undefined) {
    this.#name = value;
  }

  @accessor({ type: 'number', label: 'Units in stock' })
  get stock(): number {
    return this.#stock;
  }
  set stock(value: number) {
    this.#stock = value;
  }

  @accessor({ type: 'link', label: 'Brand' })
  get brand(): EntityLink<WidgetBrand> {
    return this.#brand;
  }
}

function makeWidget(): Widget {
  const brand = new WidgetBrand();
  brand.id = 'brand-1';
  brand.name = 'Acme';

  const widget = new Widget();
  widget.id = 'widget-1';
  widget.name = 'Sprocket';
  widget.stock = 1200;
  widget.brand.setValue(brand);
  return widget;
}

const pager = {
  isLoading: false,
  totalItems: 1,
  currentPage: 1,
  pageSize: 10,
  onPageChange: () => undefined,
};

describe('EntityTable', () => {
  beforeEach(() => window.localStorage.clear());

  it('builds its columns from the entity metadata', () => {
    render(
      <EntityTable
        entityConstructor={Widget}
        items={[makeWidget()]}
        {...pager}
      />,
    );

    // Declared labels, not accessor names.
    expect(screen.getAllByText('Units in stock').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Brand').length).toBeGreaterThan(0);
  });

  it('formats values by their declared type', () => {
    render(
      <EntityTable
        entityConstructor={Widget}
        items={[makeWidget()]}
        {...pager}
      />,
    );

    // A number is localized, and a loaded link reads as its target's label.
    expect(screen.getAllByText('1,200').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Acme').length).toBeGreaterThan(0);
  });

  it('renders a foreign-key link as its id when the target is not loaded', () => {
    const widget = makeWidget();
    widget.brand.setValue(undefined);
    widget.brand.setId('brand-9');

    render(
      <EntityTable entityConstructor={Widget} items={[widget]} {...pager} />,
    );

    expect(screen.getAllByText('brand-9').length).toBeGreaterThan(0);
  });

  it('lets a slot override a column', () => {
    render(
      <EntityTable entityConstructor={Widget} items={[makeWidget()]} {...pager}>
        <EntityColumn<Widget>
          field="brand"
          label="Maker"
          render={widget => <b>{widget.brand.value?.name} Inc.</b>}
        />
      </EntityTable>,
    );

    expect(screen.getAllByText('Maker').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Acme Inc.').length).toBeGreaterThan(0);
  });

  it('reports an empty result set', () => {
    render(
      <EntityTable
        entityConstructor={Widget}
        items={[]}
        {...pager}
        totalItems={0}
      />,
    );

    expect(screen.getAllByText('No records').length).toBeGreaterThan(0);
  });
});
