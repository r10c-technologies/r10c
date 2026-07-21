import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ColumnSettings } from './column-settings.js';

const columns = [
  { name: 'id', label: 'ID' },
  { name: 'name', label: 'Name' },
  { name: 'stock', label: 'Stock' },
];

const openSettings = async (hidden: string[] = []) => {
  const onChange = vi.fn();
  const user = userEvent.setup();
  render(<ColumnSettings columns={columns} hidden={hidden} onChange={onChange} />);

  await user.click(screen.getByRole('button', { name: 'Columns' }));

  return { onChange, user };
};

describe('ColumnSettings', () => {
  it('opens a panel listing every column by its label', async () => {
    await openSettings();

    for (const column of columns) {
      expect(screen.getByLabelText(column.label)).toBeInTheDocument();
    }
  });

  it('shows visible columns as checked and hidden ones as unchecked', async () => {
    await openSettings(['stock']);

    expect(screen.getByLabelText('Name')).toBeChecked();
    expect(screen.getByLabelText('Stock')).not.toBeChecked();
  });

  it('hides a visible column', async () => {
    const { onChange, user } = await openSettings();

    await user.click(screen.getByLabelText('Name'));

    expect(onChange).toHaveBeenCalledWith({
      order: ['id', 'name', 'stock'],
      hidden: ['name'],
    });
  });

  it('shows a hidden column again', async () => {
    const { onChange, user } = await openSettings(['name']);

    await user.click(screen.getByLabelText('Name'));

    expect(onChange).toHaveBeenCalledWith({
      order: ['id', 'name', 'stock'],
      hidden: [],
    });
  });

  // Reordering uses explicit buttons rather than drag-and-drop, so it works on
  // touch and is keyboard-operable without any extra work.
  it('moves a column up', async () => {
    const { onChange, user } = await openSettings();

    await user.click(screen.getByRole('button', { name: 'Move Name up' }));

    expect(onChange).toHaveBeenCalledWith({
      order: ['name', 'id', 'stock'],
      hidden: [],
    });
  });

  it('moves a column down', async () => {
    const { onChange, user } = await openSettings();

    await user.click(screen.getByRole('button', { name: 'Move Name down' }));

    expect(onChange).toHaveBeenCalledWith({
      order: ['id', 'stock', 'name'],
      hidden: [],
    });
  });

  it('carries the current hidden set through a reorder', async () => {
    const { onChange, user } = await openSettings(['stock']);

    await user.click(screen.getByRole('button', { name: 'Move Name up' }));

    expect(onChange).toHaveBeenCalledWith({
      order: ['name', 'id', 'stock'],
      hidden: ['stock'],
    });
  });

  it('cannot move the first column up or the last one down', async () => {
    await openSettings();

    expect(screen.getByRole('button', { name: 'Move ID up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Stock down' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Name up' })).toBeEnabled();
  });

  // Resetting emits an empty personalization rather than the current layout —
  // that is what makes the table fall back to its metadata order.
  it('resets to the default layout', async () => {
    const { onChange, user } = await openSettings(['stock']);

    await user.click(screen.getByRole('button', { name: 'Reset to default' }));

    expect(onChange).toHaveBeenCalledWith({});
  });

  it('renders an empty panel for an entity with no columns', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ColumnSettings columns={[]} hidden={[]} onChange={onChange} />);

    await user.click(screen.getByRole('button', { name: 'Columns' }));

    expect(screen.getByRole('button', { name: 'Reset to default' })).toBeInTheDocument();
  });
});
