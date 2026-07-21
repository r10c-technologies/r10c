import type { Entity, EntityFieldDescriptor } from '@r10c/entifix-ts-core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SortBuilder } from './sort-builder.js';

interface Product extends Entity {
  name: string;
  stock: number;
}

const descriptor = (
  name: string,
  label: string,
  key = name,
): EntityFieldDescriptor => ({
  name,
  key,
  label,
  type: 'string',
  sortable: true,
  filterable: true,
  order: 0,
  linkLabelProperty: 'name',
});

const descriptors = [
  descriptor('name', 'Name'),
  descriptor('stock', 'Stock'),
];

const renderBuilder = (list: readonly EntityFieldDescriptor[] = descriptors) => {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(<SortBuilder<Product> descriptors={list} onChange={onChange} />);
  return { onChange, user };
};

const addSort = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Add sort' }));

describe('SortBuilder', () => {
  it('says so when the entity has nothing sortable', () => {
    renderBuilder([]);

    expect(screen.getByText(/No sortable members/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add sort' })).not.toBeInTheDocument();
  });

  it('starts with no sorts', () => {
    renderBuilder();

    expect(screen.queryByLabelText('Sort member')).not.toBeInTheDocument();
  });

  it('adds a first sort defaulting to the first member, ascending', async () => {
    const { onChange, user } = renderBuilder();

    await addSort(user);

    expect(screen.getByLabelText('Sort member')).toHaveValue('name');
    expect(screen.getByLabelText('Sort direction')).toHaveValue('asc');
    expect(onChange).toHaveBeenCalledWith({ 0: { property: 'name', type: 'asc' } });
  });

  it('changes the sorted member', async () => {
    const { onChange, user } = renderBuilder();
    await addSort(user);

    await user.selectOptions(screen.getByLabelText('Sort member'), 'stock');

    expect(onChange).toHaveBeenLastCalledWith({
      0: { property: 'stock', type: 'asc' },
    });
  });

  it('changes the direction', async () => {
    const { onChange, user } = renderBuilder();
    await addSort(user);

    await user.selectOptions(screen.getByLabelText('Sort direction'), 'desc');

    expect(onChange).toHaveBeenLastCalledWith({
      0: { property: 'name', type: 'desc' },
    });
  });

  // The emitted `EntitySorting` is keyed by position, so the list order *is*
  // the sort precedence — reordering the rows is the only way to express it.
  it('emits list position as sort precedence', async () => {
    const { onChange, user } = renderBuilder();
    await addSort(user);
    await addSort(user);

    expect(onChange).toHaveBeenLastCalledWith({
      0: { property: 'name', type: 'asc' },
      1: { property: 'name', type: 'asc' },
    });
  });

  it('labels the first row differently from the rest', async () => {
    const { user } = renderBuilder();
    await addSort(user);
    await addSort(user);

    expect(screen.getByText('Sort by')).toBeInTheDocument();
    expect(screen.getByText('then by')).toBeInTheDocument();
  });

  it('raises a sort’s priority', async () => {
    const { onChange, user } = renderBuilder();
    await addSort(user);
    await addSort(user);
    await user.selectOptions(screen.getAllByLabelText('Sort member')[1]!, 'stock');

    await user.click(screen.getAllByRole('button', { name: 'Raise sort priority' })[1]!);

    expect(onChange).toHaveBeenLastCalledWith({
      0: { property: 'stock', type: 'asc' },
      1: { property: 'name', type: 'asc' },
    });
  });

  it('lowers a sort’s priority', async () => {
    const { onChange, user } = renderBuilder();
    await addSort(user);
    await addSort(user);
    await user.selectOptions(screen.getAllByLabelText('Sort member')[1]!, 'stock');

    await user.click(screen.getAllByRole('button', { name: 'Lower sort priority' })[0]!);

    expect(onChange).toHaveBeenLastCalledWith({
      0: { property: 'stock', type: 'asc' },
      1: { property: 'name', type: 'asc' },
    });
  });

  it('cannot raise the first sort or lower the last', async () => {
    const { user } = renderBuilder();
    await addSort(user);
    await addSort(user);

    expect(
      screen.getAllByRole('button', { name: 'Raise sort priority' })[0],
    ).toBeDisabled();
    expect(
      screen.getAllByRole('button', { name: 'Lower sort priority' })[1],
    ).toBeDisabled();
  });

  it('removes a sort and re-keys the rest', async () => {
    const { onChange, user } = renderBuilder();
    await addSort(user);
    await addSort(user);
    await user.selectOptions(screen.getAllByLabelText('Sort member')[1]!, 'stock');

    await user.click(screen.getAllByRole('button', { name: 'Remove sort' })[0]!);

    expect(onChange).toHaveBeenLastCalledWith({
      0: { property: 'stock', type: 'asc' },
    });
  });

  it('emits an empty sorting once the last sort is removed', async () => {
    const { onChange, user } = renderBuilder();
    await addSort(user);

    await user.click(screen.getByRole('button', { name: 'Remove sort' }));

    expect(onChange).toHaveBeenLastCalledWith({});
  });

  it('changes the direction of a later sort without touching the first', async () => {
    const { onChange, user } = renderBuilder();
    await addSort(user);
    await addSort(user);

    await user.selectOptions(screen.getAllByLabelText('Sort direction')[1]!, 'desc');

    expect(onChange).toHaveBeenLastCalledWith({
      0: { property: 'name', type: 'asc' },
      1: { property: 'name', type: 'desc' },
    });
  });

  // A member can disappear from the entity between renders. Its draft row is
  // then dropped from the emitted sorting rather than emitting a property the
  // service does not know.
  it('drops a draft whose member is no longer sortable', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(
      <SortBuilder<Product> descriptors={descriptors} onChange={onChange} />,
    );
    await addSort(user);
    await addSort(user);
    await user.selectOptions(screen.getAllByLabelText('Sort member')[1]!, 'stock');

    rerender(
      <SortBuilder<Product> descriptors={[descriptors[0]!]} onChange={onChange} />,
    );
    await user.click(screen.getAllByRole('button', { name: 'Raise sort priority' })[1]!);

    expect(onChange).toHaveBeenLastCalledWith({
      1: { property: 'name', type: 'asc' },
    });
  });

  // The emitted property is the descriptor's `key` — its wire name — not the
  // member name, so an aliased member sorts on what the service understands.
  it('emits the descriptor’s wire key rather than its member name', async () => {
    const { onChange, user } = renderBuilder([
      descriptor('releasedAt', 'Released', 'released_at'),
    ]);

    await addSort(user);

    expect(onChange).toHaveBeenCalledWith({
      0: { property: 'released_at', type: 'asc' },
    });
  });
});
