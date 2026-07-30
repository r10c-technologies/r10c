import type {
  Entity,
  EntityFieldDescriptor,
  MetaAccessorType,
} from '@r10c/entifix-ts-core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { FilterBuilder } from './filter-builder.js';

interface Product extends Entity {
  name: string;
  stock: number;
  status: string;
  active: boolean;
  at: Date;
  releasedAt: string;
}

const descriptor = (
  name: string,
  type: MetaAccessorType,
  extra: Partial<EntityFieldDescriptor> = {},
): EntityFieldDescriptor => ({
  name,
  key: name,
  label: name,
  type,
  sortable: true,
  filterable: true,
  order: 0,
  readonly: false,
  required: false,
  linkLabelProperty: 'name',
  linkSearchProperty: 'name',
  linkSerialization: 'id',
  ...extra,
});

const renderBuilder = (descriptors: readonly EntityFieldDescriptor[]) => {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(
    <FilterBuilder<Product> descriptors={descriptors} onChange={onChange} />,
  );
  return { onChange, user };
};

const addFilter = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Añadir filtro' }));

/**
 * Editing is a draft; nothing reaches `onChange` until the panel is applied.
 * Every emission assertion therefore commits first.
 */
const apply = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Aplicar filtros' }));

const lastFiltering = (onChange: ReturnType<typeof vi.fn>) =>
  onChange.mock.calls.at(-1)?.[0];

describe('FilterBuilder', () => {
  it('says so when the entity has nothing filterable', () => {
    renderBuilder([]);

    expect(screen.getByText(/no tiene miembros filtrables/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Añadir filtro' }),
    ).not.toBeInTheDocument();
  });

  it('starts with no filters and matches all', () => {
    renderBuilder([descriptor('name', 'string')]);

    expect(screen.getByLabelText('Coincidir todos o cualquiera de los filtros')).toHaveValue('and');
    expect(screen.queryByLabelText('Miembro del filtro')).not.toBeInTheDocument();
  });

  it('switches between matching all and any', async () => {
    const { onChange, user } = renderBuilder([descriptor('name', 'string')]);

    await user.selectOptions(
      screen.getByLabelText('Coincidir todos o cualquiera de los filtros'),
      'or',
    );

    await apply(user);

    expect(lastFiltering(onChange)).toEqual({ operator: 'or', values: [] });
  });

  it('adds a row defaulting to the first member and its first operator', async () => {
    const { user } = renderBuilder([
      descriptor('name', 'string'),
      descriptor('stock', 'number'),
    ]);

    await addFilter(user);

    expect(screen.getByLabelText('Miembro del filtro')).toHaveValue('name');
    expect(screen.getByLabelText('Operador del filtro')).toHaveValue('like');
  });

  // A half-typed row must not reach the load request, or the listing refetches
  // on every keystroke against a filter the user has not finished writing.
  it('emits nothing for a row with no value yet', async () => {
    const { onChange, user } = renderBuilder([descriptor('name', 'string')]);

    await addFilter(user);

    await apply(user);

    expect(lastFiltering(onChange)).toEqual({ operator: 'and', values: [] });
  });

  it('emits a single-value filter once a value is typed', async () => {
    const { onChange, user } = renderBuilder([descriptor('name', 'string')]);
    await addFilter(user);

    await user.type(screen.getByLabelText('Valor del filtro'), 'Ac');

    await apply(user);

    expect(lastFiltering(onChange)).toEqual({
      operator: 'and',
      values: [{ property: 'name', operator: 'like', value: 'Ac' }],
    });
  });

  it('emits a value-less filter for an emptiness operator', async () => {
    const { onChange, user } = renderBuilder([descriptor('name', 'string')]);
    await addFilter(user);

    await user.selectOptions(
      screen.getByLabelText('Operador del filtro'),
      'isNull',
    );

    expect(screen.queryByLabelText('Valor del filtro')).not.toBeInTheDocument();

    await apply(user);

    expect(lastFiltering(onChange)).toEqual({
      operator: 'and',
      values: [{ property: 'name', operator: 'isNull' }],
    });
  });

  it('removes a row', async () => {
    const { onChange, user } = renderBuilder([descriptor('name', 'string')]);
    await addFilter(user);
    await user.type(screen.getByLabelText('Valor del filtro'), 'Ac');

    await user.click(screen.getByRole('button', { name: 'Quitar filtro' }));

    await apply(user);

    expect(lastFiltering(onChange)).toEqual({ operator: 'and', values: [] });
  });

  // Operators are per-type, so the previous one may not exist for the new
  // member; keeping it would emit a filter the service cannot answer.
  it('resets the operator and value when the member changes', async () => {
    const { user } = renderBuilder([
      descriptor('name', 'string'),
      descriptor('stock', 'number'),
    ]);
    await addFilter(user);
    await user.type(screen.getByLabelText('Valor del filtro'), 'Ac');

    await user.selectOptions(screen.getByLabelText('Miembro del filtro'), 'stock');

    expect(screen.getByLabelText('Operador del filtro')).toHaveValue('eq');
    expect(screen.getByLabelText('Valor del filtro')).toHaveValue(null);
  });

  it('emits the descriptor’s wire key rather than its member name', async () => {
    const { onChange, user } = renderBuilder([
      descriptor('releasedAt', 'string', { key: 'released_at' }),
    ]);
    await addFilter(user);

    await user.type(screen.getByLabelText('Valor del filtro'), 'x');

    await apply(user);

    expect(lastFiltering(onChange)?.values[0].property).toBe('released_at');
  });

  describe('value coercion', () => {
    it('coerces a number member’s value to a number', async () => {
      const { onChange, user } = renderBuilder([descriptor('stock', 'number')]);
      await addFilter(user);

      await user.type(screen.getByLabelText('Valor del filtro'), '42');

      await apply(user);

      expect(lastFiltering(onChange)?.values[0].value).toBe(42);
    });

    it('coerces a date member’s value to a Date', async () => {
      const { onChange, user } = renderBuilder([descriptor('at', 'date')]);
      await addFilter(user);

      await user.type(screen.getByLabelText('Valor del filtro'), '2026-07-20');

      await apply(user);

      expect(lastFiltering(onChange)?.values[0].value).toBeInstanceOf(Date);
    });

    it('coerces a boolean member’s value', async () => {
      const { onChange, user } = renderBuilder([
        descriptor('active', 'boolean'),
      ]);
      await addFilter(user);

      await user.selectOptions(screen.getByLabelText('Valor del filtro'), 'false');

      await apply(user);

      expect(lastFiltering(onChange)?.values[0].value).toBe(false);
    });
  });

  describe('the value control', () => {
    it('offers yes/no for a boolean member', async () => {
      const { user } = renderBuilder([descriptor('active', 'boolean')]);

      await addFilter(user);

      expect(screen.getByRole('option', { name: 'Sí' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'No' })).toBeInTheDocument();
    });

    it('offers the declared values for an enum member', async () => {
      const { user } = renderBuilder([
        descriptor('status', 'enum', { enumValues: ['draft', 'live'] }),
      ]);

      await addFilter(user);

      expect(screen.getByRole('option', { name: 'draft' })).toBeInTheDocument();
    });

    // A set-membership filter takes a list, so it needs free text rather than
    // a single-choice select even for an enum member.
    it('falls back to free text for a set-membership filter on an enum', async () => {
      const { user } = renderBuilder([
        descriptor('status', 'enum', { enumValues: ['draft', 'live'] }),
      ]);
      await addFilter(user);

      await user.selectOptions(screen.getByLabelText('Operador del filtro'), 'in');

      expect(screen.getByLabelText('Valor del filtro')).toHaveAttribute(
        'placeholder',
        'valores, separados, por comas',
      );
    });

    it('falls back to free text for an enum with no declared values', async () => {
      const { user } = renderBuilder([descriptor('status', 'enum')]);

      await addFilter(user);

      expect(screen.getByLabelText('Valor del filtro')).toHaveAttribute(
        'type',
        'text',
      );
    });

    it.each([
      ['number', 'number'],
      ['date', 'date'],
      ['string', 'text'],
    ] as const)('uses a %s input for a %s member', async (type, inputType) => {
      const { user } = renderBuilder([descriptor('field', type)]);

      await addFilter(user);

      expect(screen.getByLabelText('Valor del filtro')).toHaveAttribute(
        'type',
        inputType,
      );
    });
  });

  describe('list filters', () => {
    it('splits a comma-separated list, trimming and dropping blanks', async () => {
      const { onChange, user } = renderBuilder([
        descriptor('status', 'enum', { enumValues: ['draft'] }),
      ]);
      await addFilter(user);
      await user.selectOptions(screen.getByLabelText('Operador del filtro'), 'in');

      await user.type(screen.getByLabelText('Valor del filtro'), 'a, b ,, c');

      await apply(user);

      expect(lastFiltering(onChange)?.values[0]).toEqual({
        property: 'status',
        operator: 'in',
        values: ['a', 'b', 'c'],
      });
    });

    it('emits nothing while the list is still empty', async () => {
      const { onChange, user } = renderBuilder([
        descriptor('status', 'enum', { enumValues: ['draft'] }),
      ]);
      await addFilter(user);

      await user.selectOptions(screen.getByLabelText('Operador del filtro'), 'in');

      await apply(user);

      expect(lastFiltering(onChange)).toEqual({ operator: 'and', values: [] });
    });
  });

  describe('range filters', () => {
    it('renders a second input for the upper bound', async () => {
      const { user } = renderBuilder([descriptor('stock', 'number')]);
      await addFilter(user);

      await user.selectOptions(
        screen.getByLabelText('Operador del filtro'),
        'between',
      );

      expect(screen.getByLabelText('Fin del rango del filtro')).toBeInTheDocument();
    });

    it('emits only once both bounds are given', async () => {
      const { onChange, user } = renderBuilder([descriptor('stock', 'number')]);
      await addFilter(user);
      await user.selectOptions(
        screen.getByLabelText('Operador del filtro'),
        'between',
      );

      await user.type(screen.getByLabelText('Valor del filtro'), '1');

      await apply(user);

      expect(lastFiltering(onChange)).toEqual({ operator: 'and', values: [] });

      await user.type(screen.getByLabelText('Fin del rango del filtro'), '9');

      await apply(user);

      expect(lastFiltering(onChange)?.values[0]).toEqual({
        property: 'stock',
        operator: 'between',
        start: 1,
        end: 9,
      });
    });

    it('emits nothing when only the upper bound is given', async () => {
      const { onChange, user } = renderBuilder([descriptor('stock', 'number')]);
      await addFilter(user);
      await user.selectOptions(
        screen.getByLabelText('Operador del filtro'),
        'between',
      );

      await user.type(screen.getByLabelText('Fin del rango del filtro'), '9');

      await apply(user);

      expect(lastFiltering(onChange)).toEqual({ operator: 'and', values: [] });
    });
  });

  it('combines several rows under the chosen logic', async () => {
    const { onChange, user } = renderBuilder([
      descriptor('name', 'string'),
      descriptor('stock', 'number'),
    ]);
    await addFilter(user);
    await user.type(screen.getAllByLabelText('Valor del filtro')[0]!, 'Ac');
    await addFilter(user);
    await user.selectOptions(
      screen.getAllByLabelText('Miembro del filtro')[1]!,
      'stock',
    );
    await user.type(screen.getAllByLabelText('Valor del filtro')[1]!, '5');

    await apply(user);

    expect(lastFiltering(onChange)).toEqual({
      operator: 'and',
      values: [
        { property: 'name', operator: 'like', value: 'Ac' },
        { property: 'stock', operator: 'eq', value: 5 },
      ],
    });
  });
});

describe('FilterBuilder enum values', () => {
  it('emits the chosen enum value', async () => {
    const { onChange, user } = renderBuilder([
      descriptor('status', 'enum', { enumValues: ['draft', 'live'] }),
    ]);
    await addFilter(user);

    await user.selectOptions(screen.getByLabelText('Valor del filtro'), 'live');

    await apply(user);

    expect(lastFiltering(onChange)?.values[0]).toEqual({
      property: 'status',
      operator: 'eq',
      value: 'live',
    });
  });
});

// A member can stop being filterable between renders. Its row disappears and
// its draft is dropped from the emitted filtering, rather than emitting a
// property the service no longer accepts.
describe('FilterBuilder when a member disappears', () => {
  const descriptors = [
    descriptor('name', 'string'),
    descriptor('stock', 'number'),
  ];

  it('drops the row and its filter', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <FilterBuilder<Product> descriptors={descriptors} onChange={onChange} />,
    );
    await addFilter(user);
    await user.selectOptions(screen.getByLabelText('Miembro del filtro'), 'stock');
    await user.type(screen.getByLabelText('Valor del filtro'), '5');
    await addFilter(user);

    rerender(
      <FilterBuilder<Product>
        descriptors={[descriptors[0]!]}
        onChange={onChange}
      />,
    );

    expect(screen.getAllByLabelText('Miembro del filtro')).toHaveLength(1);

    await user.selectOptions(
      screen.getByLabelText('Coincidir todos o cualquiera de los filtros'),
      'or',
    );

    await apply(user);

    expect(lastFiltering(onChange)).toEqual({ operator: 'or', values: [] });
  });
});

/**
 * The value feeds a load request, so an emission is an HTTP round trip. Editing
 * must therefore stay local until the user says so.
 */
describe('committing', () => {
  it('emits nothing while the form is being edited', async () => {
    const { onChange, user } = renderBuilder([descriptor('name', 'string')]);

    await addFilter(user);
    await user.type(screen.getByLabelText('Valor del filtro'), 'Acme');
    await user.selectOptions(
      screen.getByLabelText('Coincidir todos o cualquiera de los filtros'),
      'or',
    );

    expect(onChange).not.toHaveBeenCalled();
  });

  it('emits once per apply, not once per keystroke', async () => {
    const { onChange, user } = renderBuilder([descriptor('name', 'string')]);
    await addFilter(user);

    await user.type(screen.getByLabelText('Valor del filtro'), 'Acme');
    await apply(user);

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('clears the rows and applies the emptied filtering', async () => {
    const { onChange, user } = renderBuilder([descriptor('name', 'string')]);
    await addFilter(user);
    await user.type(screen.getByLabelText('Valor del filtro'), 'Acme');
    await user.selectOptions(
      screen.getByLabelText('Coincidir todos o cualquiera de los filtros'),
      'or',
    );

    await user.click(screen.getByRole('button', { name: 'Limpiar filtros' }));

    expect(screen.queryByLabelText('Miembro del filtro')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Coincidir todos o cualquiera de los filtros')).toHaveValue('and');
    expect(lastFiltering(onChange)).toEqual({ operator: 'and', values: [] });
  });
});

/**
 * Reopening the panel has to show what is actually in effect; an empty form
 * would suggest nothing is filtered while the listing is plainly narrowed.
 */
describe('seeding from the applied value', () => {
  it('rebuilds a single-value row', () => {
    render(
      <FilterBuilder<Product>
        descriptors={[descriptor('name', 'string')]}
        value={{
          operator: 'or',
          values: [{ property: 'name', operator: 'like', value: 'Acme' }],
        }}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Miembro del filtro')).toHaveValue('name');
    expect(screen.getByLabelText('Operador del filtro')).toHaveValue('like');
    expect(screen.getByLabelText('Valor del filtro')).toHaveValue('Acme');
    expect(screen.getByLabelText('Coincidir todos o cualquiera de los filtros')).toHaveValue('or');
  });

  it('rebuilds a list row as comma-separated text', () => {
    render(
      <FilterBuilder<Product>
        descriptors={[descriptor('status', 'enum', { enumValues: ['a', 'b'] })]}
        value={{
          operator: 'and',
          values: [{ property: 'status', operator: 'in', values: ['a', 'b'] }],
        }}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Valor del filtro')).toHaveValue('a, b');
  });

  it('rebuilds both bounds of a range row', () => {
    render(
      <FilterBuilder<Product>
        descriptors={[descriptor('stock', 'number')]}
        value={{
          operator: 'and',
          values: [
            { property: 'stock', operator: 'between', start: 1, end: 9 },
          ],
        }}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Valor del filtro')).toHaveValue(1);
    expect(screen.getByLabelText('Fin del rango del filtro')).toHaveValue(9);
  });

  it('rebuilds a date row as the date input’s format', () => {
    render(
      <FilterBuilder<Product>
        descriptors={[descriptor('at', 'date')]}
        value={{
          operator: 'and',
          values: [
            {
              property: 'at',
              operator: 'eq',
              value: new Date('2026-07-21T10:00:00.000Z'),
            },
          ],
        }}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Valor del filtro')).toHaveValue('2026-07-21');
  });

  it('leaves a value-less row empty', () => {
    render(
      <FilterBuilder<Product>
        descriptors={[descriptor('name', 'string')]}
        value={{
          operator: 'and',
          values: [{ property: 'name', operator: 'isNull' }],
        }}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Operador del filtro')).toHaveValue('isNull');
    expect(screen.queryByLabelText('Valor del filtro')).not.toBeInTheDocument();
  });

  // Only the flat rows this builder can express are restored; a nested group
  // came from somewhere else and is not editable here.
  it('skips a nested group', () => {
    render(
      <FilterBuilder<Product>
        descriptors={[descriptor('name', 'string')]}
        value={{
          operator: 'and',
          values: [
            {
              operator: 'or',
              values: [{ property: 'name', operator: 'eq', value: 'Acme' }],
            },
          ],
        }}
        onChange={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText('Miembro del filtro')).not.toBeInTheDocument();
  });

  it('starts empty when nothing is applied', () => {
    render(
      <FilterBuilder<Product>
        descriptors={[descriptor('name', 'string')]}
        onChange={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText('Miembro del filtro')).not.toBeInTheDocument();
  });
});
