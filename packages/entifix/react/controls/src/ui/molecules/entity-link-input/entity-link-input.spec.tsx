import {
  accessor,
  EntifixConnError,
  type Entity,
  entity,
  type EntityFieldDescriptor,
  type EntityId,
  type EntityLinkSource,
} from '@r10c/entifix-ts-core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { EntityLinkInput } from './entity-link-input';

@entity({ key: 'link-brand' })
class LinkBrand implements Entity {
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

const descriptor = (
  overrides: Partial<EntityFieldDescriptor> = {},
): EntityFieldDescriptor => ({
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
  ...overrides,
});

const OPTIONS = [new LinkBrand('b-1', 'Acme'), new LinkBrand('b-2', 'Globex')];

/**
 * The source built from a literal — no fetch, no Effect, no provider. That this
 * is possible is the contract: the port is plain data plus callbacks, so the
 * editor is testable without the integration layer that normally produces one.
 */
function fakeSource(
  overrides: {
    selected?: EntityLinkSource<LinkBrand>['selected'];
    quick?: Partial<EntityLinkSource<LinkBrand>['quick']>;
    browse?: Partial<EntityLinkSource<LinkBrand>['browse']>;
  } = {},
): EntityLinkSource<LinkBrand> {
  return {
    entityConstructor: LinkBrand,
    labelOf: target => target.name ?? String(target.id),
    selected: overrides.selected ?? { isLoading: false },
    quick: {
      term: '',
      setTerm: vi.fn(),
      options: OPTIONS,
      isLoading: false,
      ...overrides.quick,
    },
    browse: {
      items: OPTIONS,
      totalItems: OPTIONS.length,
      currentPage: 1,
      pageSize: 10,
      isLoading: false,
      onPageChange: vi.fn(),
      onPageSizeChange: vi.fn(),
      onFilteringChange: vi.fn(),
      onSortingChange: vi.fn(),
      isOpen: false,
      open: vi.fn(),
      close: vi.fn(),
      ...overrides.browse,
    },
  };
}

const renderInput = (
  props: Partial<Parameters<typeof EntityLinkInput<LinkBrand>>[0]> = {},
) => {
  const source = props.source ?? fakeSource();
  const onSelect = props.onSelect ?? vi.fn();
  const onClear = props.onClear ?? vi.fn();
  render(
    <EntityLinkInput<LinkBrand>
      descriptor={props.descriptor ?? descriptor()}
      value={props.value ?? ''}
      source={source}
      onSelect={onSelect}
      onClear={onClear}
      disabled={props.disabled}
    />,
  );
  return { source, onSelect, onClear };
};

const heldValue = () => screen.getByTestId('entity-link-value-brand');

describe('EntityLinkInput', () => {
  it('reads as unassigned when the draft holds no key', () => {
    renderInput();

    expect(heldValue()).toHaveTextContent('— sin asignar —');
  });

  it('shows the resolved label of the held key', () => {
    renderInput({
      value: 'b-1',
      source: fakeSource({ selected: { label: 'Acme', isLoading: false } }),
    });

    expect(heldValue()).toHaveTextContent('Acme');
  });

  // A foreign key is not a name, but it is true — better than an empty box while
  // the label is still on its way, or when nothing can resolve it.
  it('falls back to the bare foreign key when no label is known', () => {
    renderInput({ value: 'b-9' });

    expect(heldValue()).toHaveTextContent('b-9');
  });

  it('says so while the label is resolving', () => {
    renderInput({
      value: 'b-1',
      source: fakeSource({ selected: { isLoading: true } }),
    });

    expect(heldValue()).toHaveTextContent('Cargando…');
  });

  it('reports the term the user types', async () => {
    const { source } = renderInput();

    await userEvent.type(screen.getByLabelText('Buscar Brand'), 'ac');

    expect(source.quick.setTerm).toHaveBeenCalledWith('a');
    expect(source.quick.setTerm).toHaveBeenCalledWith('c');
  });

  it('reports the option picked from the quick search and resets the term', async () => {
    const { source, onSelect } = renderInput();

    await userEvent.click(
      screen.getByRole('button', { name: 'Ver sugerencias de Brand' }),
    );
    await userEvent.click(screen.getByRole('option', { name: 'Acme' }));

    expect(onSelect).toHaveBeenCalledWith(OPTIONS[0]);
    expect(source.quick.setTerm).toHaveBeenCalledWith('');
  });

  // Abandoning the search must not empty the relation: Headless UI reports a
  // `null` selection on escape, and clearing is the button next to the input.
  it('keeps the held value when the search is abandoned', async () => {
    const { onSelect, onClear } = renderInput({ value: 'b-1' });

    await userEvent.click(screen.getByLabelText('Buscar Brand'));
    await userEvent.keyboard('{Escape}');

    expect(onSelect).not.toHaveBeenCalled();
    expect(onClear).not.toHaveBeenCalled();
    expect(heldValue()).toHaveTextContent('b-1');
  });

  it('opens the browse dialog', async () => {
    const { source } = renderInput();

    await userEvent.click(
      screen.getByRole('button', { name: 'Examinar Brand' }),
    );

    expect(source.browse.open).toHaveBeenCalled();
  });

  it('reports selection from the browse dialog and closes it', async () => {
    const source = fakeSource({ browse: { isOpen: true } });
    const { onSelect } = renderInput({ value: '', source });

    await userEvent.click(
      screen.getAllByRole('button', { name: 'Seleccionar' })[0]!,
    );

    expect(onSelect).toHaveBeenCalledWith(OPTIONS[0]);
    expect(source.browse.close).toHaveBeenCalled();
  });

  it('offers clearing only once something is held', async () => {
    const { onClear } = renderInput({ value: 'b-1' });

    await userEvent.click(screen.getByRole('button', { name: 'Quitar Brand' }));

    expect(onClear).toHaveBeenCalled();
  });

  it('does not offer clearing an empty relation', () => {
    renderInput();

    expect(
      screen.queryByRole('button', { name: 'Quitar Brand' }),
    ).not.toBeInTheDocument();
  });

  it('offers nothing to change when disabled', () => {
    renderInput({ value: 'b-1', disabled: true });

    expect(
      screen.queryByRole('button', { name: 'Quitar Brand' }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText('Buscar Brand')).toBeDisabled();
  });

  it('reports an empty quick search and one that failed', () => {
    const { source } = renderInput({
      source: fakeSource({
        quick: { options: [], error: new EntifixConnError('offline') },
      }),
    });

    expect(screen.getByRole('alert')).toHaveTextContent('offline');
    expect(source.quick.options).toHaveLength(0);
  });

  it('says the quick search is still loading', async () => {
    renderInput({
      source: fakeSource({ quick: { isLoading: true, options: [] } }),
    });

    await userEvent.click(
      screen.getByRole('button', { name: 'Ver sugerencias de Brand' }),
    );

    expect(screen.getAllByText('Cargando…').length).toBeGreaterThan(0);
  });

  it('says when a term matches nothing', async () => {
    renderInput({ source: fakeSource({ quick: { options: [] } }) });

    await userEvent.click(
      screen.getByRole('button', { name: 'Ver sugerencias de Brand' }),
    );

    expect(screen.getByText('Sin coincidencias')).toBeInTheDocument();
  });
});
