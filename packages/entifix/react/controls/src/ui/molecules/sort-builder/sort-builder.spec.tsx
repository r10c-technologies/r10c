import type {
  Entity,
  EntityFieldDescriptor,
  EntitySorting,
} from '@r10c/entifix-ts-core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { SortBuilder } from './sort-builder.js';

interface Product extends Entity {
  name: string;
  stock: number;
  released_at: string;
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

const descriptors = [descriptor('name', 'Name'), descriptor('stock', 'Stock')];

const renderBuilder = (
  list: readonly EntityFieldDescriptor[] = descriptors,
) => {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(<SortBuilder<Product> descriptors={list} onChange={onChange} />);
  return { onChange, user };
};

const addSort = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Add sort' }));

/**
 * Editing is a draft; nothing reaches `onChange` until the panel is applied.
 * Every emission assertion therefore commits first.
 */
const apply = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Apply sorting' }));

describe('SortBuilder', () => {
  it('says so when the entity has nothing sortable', () => {
    renderBuilder([]);

    expect(screen.getByText(/No sortable members/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Add sort' }),
    ).not.toBeInTheDocument();
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

    await apply(user);

    expect(onChange).toHaveBeenCalledWith({
      0: { property: 'name', type: 'asc' },
    });
  });

  it('changes the sorted member', async () => {
    const { onChange, user } = renderBuilder();
    await addSort(user);

    await user.selectOptions(screen.getByLabelText('Sort member'), 'stock');

    await apply(user);

    expect(onChange).toHaveBeenLastCalledWith({
      0: { property: 'stock', type: 'asc' },
    });
  });

  it('changes the direction', async () => {
    const { onChange, user } = renderBuilder();
    await addSort(user);

    await user.selectOptions(screen.getByLabelText('Sort direction'), 'desc');

    await apply(user);

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

    await apply(user);

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
    await user.selectOptions(
      screen.getAllByLabelText('Sort member')[1]!,
      'stock',
    );

    await user.click(
      screen.getAllByRole('button', { name: 'Raise sort priority' })[1]!,
    );

    await apply(user);

    expect(onChange).toHaveBeenLastCalledWith({
      0: { property: 'stock', type: 'asc' },
      1: { property: 'name', type: 'asc' },
    });
  });

  it('lowers a sort’s priority', async () => {
    const { onChange, user } = renderBuilder();
    await addSort(user);
    await addSort(user);
    await user.selectOptions(
      screen.getAllByLabelText('Sort member')[1]!,
      'stock',
    );

    await user.click(
      screen.getAllByRole('button', { name: 'Lower sort priority' })[0]!,
    );

    await apply(user);

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
    await user.selectOptions(
      screen.getAllByLabelText('Sort member')[1]!,
      'stock',
    );

    await user.click(
      screen.getAllByRole('button', { name: 'Remove sort' })[0]!,
    );

    await apply(user);

    expect(onChange).toHaveBeenLastCalledWith({
      0: { property: 'stock', type: 'asc' },
    });
  });

  it('emits an empty sorting once the last sort is removed', async () => {
    const { onChange, user } = renderBuilder();
    await addSort(user);

    await user.click(screen.getByRole('button', { name: 'Remove sort' }));

    await apply(user);

    expect(onChange).toHaveBeenLastCalledWith({});
  });

  it('changes the direction of a later sort without touching the first', async () => {
    const { onChange, user } = renderBuilder();
    await addSort(user);
    await addSort(user);

    await user.selectOptions(
      screen.getAllByLabelText('Sort direction')[1]!,
      'desc',
    );

    await apply(user);

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
    await user.selectOptions(
      screen.getAllByLabelText('Sort member')[1]!,
      'stock',
    );

    rerender(
      <SortBuilder<Product>
        descriptors={[descriptors[0]!]}
        onChange={onChange}
      />,
    );
    await user.click(
      screen.getAllByRole('button', { name: 'Raise sort priority' })[1]!,
    );

    await apply(user);

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

    await apply(user);

    expect(onChange).toHaveBeenCalledWith({
      0: { property: 'released_at', type: 'asc' },
    });
  });
});

/** As in the filter builder, each emission is a round trip to the server. */
describe('committing', () => {
  it('emits nothing while the form is being edited', async () => {
    const { onChange, user } = renderBuilder();

    await addSort(user);
    await user.selectOptions(screen.getByLabelText('Sort direction'), 'desc');

    expect(onChange).not.toHaveBeenCalled();
  });

  it('clears the rows and applies the emptied sorting', async () => {
    const { onChange, user } = renderBuilder();
    await addSort(user);

    await user.click(screen.getByRole('button', { name: 'Clear sorting' }));

    expect(screen.queryByLabelText('Sort member')).not.toBeInTheDocument();
    expect(onChange).toHaveBeenLastCalledWith({});
  });
});

describe('seeding from the applied value', () => {
  it('rebuilds the rows in precedence order', () => {
    render(
      <SortBuilder<Product>
        descriptors={descriptors}
        value={{
          1: { property: 'stock', type: 'desc' },
          0: { property: 'name', type: 'asc' },
        }}
        onChange={vi.fn()}
      />,
    );

    const members = screen.getAllByLabelText('Sort member');
    expect(members[0]).toHaveValue('name');
    expect(members[1]).toHaveValue('stock');
    expect(screen.getAllByLabelText('Sort direction')[1]).toHaveValue('desc');
  });

  // An applied value carries the wire key; the rows address members by name.
  it('maps a wire key back to its member', () => {
    render(
      <SortBuilder<Product>
        descriptors={[descriptor('releasedAt', 'Released', 'released_at')]}
        value={{ 0: { property: 'released_at', type: 'asc' } }}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Sort member')).toHaveValue('releasedAt');
  });

  // Both of these are shapes the type system forbids but a persisted or
  // server-sent value can still arrive as: a member since removed from the
  // entity, and a gap in the priority record.
  it('skips a member the entity no longer exposes', () => {
    render(
      <SortBuilder<Product>
        descriptors={descriptors}
        value={
          {
            0: { property: 'gone', type: 'asc' },
          } as unknown as EntitySorting<Product>
        }
        onChange={vi.fn()}
      />,
    );

    expect(screen.queryByLabelText('Sort member')).not.toBeInTheDocument();
  });

  it('skips a hole in the precedence record', () => {
    render(
      <SortBuilder<Product>
        descriptors={descriptors}
        value={
          {
            0: undefined,
            1: { property: 'name', type: 'asc' },
          } as unknown as EntitySorting<Product>
        }
        onChange={vi.fn()}
      />,
    );

    expect(screen.getAllByLabelText('Sort member')).toHaveLength(1);
  });

  it('starts empty when nothing is applied', () => {
    render(
      <SortBuilder<Product> descriptors={descriptors} onChange={vi.fn()} />,
    );

    expect(screen.queryByLabelText('Sort member')).not.toBeInTheDocument();
  });
});
