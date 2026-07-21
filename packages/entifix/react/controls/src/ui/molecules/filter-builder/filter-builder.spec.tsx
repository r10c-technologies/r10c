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
  linkLabelProperty: 'name',
  ...extra,
});

const renderBuilder = (descriptors: readonly EntityFieldDescriptor[]) => {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(<FilterBuilder<Product> descriptors={descriptors} onChange={onChange} />);
  return { onChange, user };
};

const addFilter = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Add filter' }));

const lastFiltering = (onChange: ReturnType<typeof vi.fn>) =>
  onChange.mock.calls.at(-1)?.[0];

describe('FilterBuilder', () => {
  it('says so when the entity has nothing filterable', () => {
    renderBuilder([]);

    expect(screen.getByText(/No filterable members/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add filter' })).not.toBeInTheDocument();
  });

  it('starts with no filters and matches all', () => {
    renderBuilder([descriptor('name', 'string')]);

    expect(screen.getByLabelText('Match all or any filter')).toHaveValue('and');
    expect(screen.queryByLabelText('Filter member')).not.toBeInTheDocument();
  });

  it('switches between matching all and any, re-emitting immediately', async () => {
    const { onChange, user } = renderBuilder([descriptor('name', 'string')]);

    await user.selectOptions(screen.getByLabelText('Match all or any filter'), 'or');

    expect(lastFiltering(onChange)).toEqual({ operator: 'or', values: [] });
  });

  it('adds a row defaulting to the first member and its first operator', async () => {
    const { user } = renderBuilder([
      descriptor('name', 'string'),
      descriptor('stock', 'number'),
    ]);

    await addFilter(user);

    expect(screen.getByLabelText('Filter member')).toHaveValue('name');
    expect(screen.getByLabelText('Filter operator')).toHaveValue('like');
  });

  // A half-typed row must not reach the load request, or the listing refetches
  // on every keystroke against a filter the user has not finished writing.
  it('emits nothing for a row with no value yet', async () => {
    const { onChange, user } = renderBuilder([descriptor('name', 'string')]);

    await addFilter(user);

    expect(lastFiltering(onChange)).toEqual({ operator: 'and', values: [] });
  });

  it('emits a single-value filter once a value is typed', async () => {
    const { onChange, user } = renderBuilder([descriptor('name', 'string')]);
    await addFilter(user);

    await user.type(screen.getByLabelText('Filter value'), 'Ac');

    expect(lastFiltering(onChange)).toEqual({
      operator: 'and',
      values: [{ property: 'name', operator: 'like', value: 'Ac' }],
    });
  });

  it('emits a value-less filter for an emptiness operator', async () => {
    const { onChange, user } = renderBuilder([descriptor('name', 'string')]);
    await addFilter(user);

    await user.selectOptions(screen.getByLabelText('Filter operator'), 'isNull');

    expect(screen.queryByLabelText('Filter value')).not.toBeInTheDocument();
    expect(lastFiltering(onChange)).toEqual({
      operator: 'and',
      values: [{ property: 'name', operator: 'isNull' }],
    });
  });

  it('removes a row', async () => {
    const { onChange, user } = renderBuilder([descriptor('name', 'string')]);
    await addFilter(user);
    await user.type(screen.getByLabelText('Filter value'), 'Ac');

    await user.click(screen.getByRole('button', { name: 'Remove filter' }));

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
    await user.type(screen.getByLabelText('Filter value'), 'Ac');

    await user.selectOptions(screen.getByLabelText('Filter member'), 'stock');

    expect(screen.getByLabelText('Filter operator')).toHaveValue('eq');
    expect(screen.getByLabelText('Filter value')).toHaveValue(null);
  });

  it('emits the descriptor’s wire key rather than its member name', async () => {
    const { onChange, user } = renderBuilder([
      descriptor('releasedAt', 'string', { key: 'released_at' }),
    ]);
    await addFilter(user);

    await user.type(screen.getByLabelText('Filter value'), 'x');

    expect(lastFiltering(onChange)?.values[0].property).toBe('released_at');
  });

  describe('value coercion', () => {
    it('coerces a number member’s value to a number', async () => {
      const { onChange, user } = renderBuilder([descriptor('stock', 'number')]);
      await addFilter(user);

      await user.type(screen.getByLabelText('Filter value'), '42');

      expect(lastFiltering(onChange)?.values[0].value).toBe(42);
    });

    it('coerces a date member’s value to a Date', async () => {
      const { onChange, user } = renderBuilder([descriptor('at', 'date')]);
      await addFilter(user);

      await user.type(screen.getByLabelText('Filter value'), '2026-07-20');

      expect(lastFiltering(onChange)?.values[0].value).toBeInstanceOf(Date);
    });

    it('coerces a boolean member’s value', async () => {
      const { onChange, user } = renderBuilder([descriptor('active', 'boolean')]);
      await addFilter(user);

      await user.selectOptions(screen.getByLabelText('Filter value'), 'false');

      expect(lastFiltering(onChange)?.values[0].value).toBe(false);
    });
  });

  describe('the value control', () => {
    it('offers yes/no for a boolean member', async () => {
      const { user } = renderBuilder([descriptor('active', 'boolean')]);

      await addFilter(user);

      expect(screen.getByRole('option', { name: 'Yes' })).toBeInTheDocument();
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

      await user.selectOptions(screen.getByLabelText('Filter operator'), 'in');

      expect(screen.getByLabelText('Filter value')).toHaveAttribute(
        'placeholder',
        'comma, separated, values',
      );
    });

    it('falls back to free text for an enum with no declared values', async () => {
      const { user } = renderBuilder([descriptor('status', 'enum')]);

      await addFilter(user);

      expect(screen.getByLabelText('Filter value')).toHaveAttribute('type', 'text');
    });

    it.each([
      ['number', 'number'],
      ['date', 'date'],
      ['string', 'text'],
    ] as const)('uses a %s input for a %s member', async (type, inputType) => {
      const { user } = renderBuilder([descriptor('field', type)]);

      await addFilter(user);

      expect(screen.getByLabelText('Filter value')).toHaveAttribute('type', inputType);
    });
  });

  describe('list filters', () => {
    it('splits a comma-separated list, trimming and dropping blanks', async () => {
      const { onChange, user } = renderBuilder([
        descriptor('status', 'enum', { enumValues: ['draft'] }),
      ]);
      await addFilter(user);
      await user.selectOptions(screen.getByLabelText('Filter operator'), 'in');

      await user.type(screen.getByLabelText('Filter value'), 'a, b ,, c');

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

      await user.selectOptions(screen.getByLabelText('Filter operator'), 'in');

      expect(lastFiltering(onChange)).toEqual({ operator: 'and', values: [] });
    });
  });

  describe('range filters', () => {
    it('renders a second input for the upper bound', async () => {
      const { user } = renderBuilder([descriptor('stock', 'number')]);
      await addFilter(user);

      await user.selectOptions(screen.getByLabelText('Filter operator'), 'between');

      expect(screen.getByLabelText('Filter range end')).toBeInTheDocument();
    });

    it('emits only once both bounds are given', async () => {
      const { onChange, user } = renderBuilder([descriptor('stock', 'number')]);
      await addFilter(user);
      await user.selectOptions(screen.getByLabelText('Filter operator'), 'between');

      await user.type(screen.getByLabelText('Filter value'), '1');
      expect(lastFiltering(onChange)).toEqual({ operator: 'and', values: [] });

      await user.type(screen.getByLabelText('Filter range end'), '9');

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
      await user.selectOptions(screen.getByLabelText('Filter operator'), 'between');

      await user.type(screen.getByLabelText('Filter range end'), '9');

      expect(lastFiltering(onChange)).toEqual({ operator: 'and', values: [] });
    });
  });

  it('combines several rows under the chosen logic', async () => {
    const { onChange, user } = renderBuilder([
      descriptor('name', 'string'),
      descriptor('stock', 'number'),
    ]);
    await addFilter(user);
    await user.type(screen.getAllByLabelText('Filter value')[0]!, 'Ac');
    await addFilter(user);
    await user.selectOptions(screen.getAllByLabelText('Filter member')[1]!, 'stock');
    await user.type(screen.getAllByLabelText('Filter value')[1]!, '5');

    expect(lastFiltering(onChange)).toEqual({
      operator: 'and',
      values: [
        { property: 'name', operator: 'like', value: 'Ac' },
        { property: 'stock', operator: 'eq', value: 5 },
      ],
    });
  });
});
