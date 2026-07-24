import type {
  EntityFieldDescriptor,
  MetaAccessorType,
} from '@r10c/entifix-ts-core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { FieldControl } from './field-control.js';

const descriptor = (
  type: MetaAccessorType,
  extra: Partial<EntityFieldDescriptor> = {},
): EntityFieldDescriptor => ({
  name: 'field',
  key: 'field',
  label: 'Field',
  type,
  sortable: true,
  filterable: true,
  order: 0,
  readonly: false,
  required: false,
  linkLabelProperty: 'name',
  ...extra,
});

describe('FieldControl', () => {
  it('renders a text input for a string member and emits edits', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <FieldControl
        descriptor={descriptor('string')}
        value=""
        onChange={onChange}
      />,
    );

    await user.type(screen.getByRole('textbox'), 'A');

    expect(onChange).toHaveBeenCalledWith('A');
  });

  it('uses a numeric input for a number member', () => {
    render(
      <FieldControl
        descriptor={descriptor('number')}
        value="3"
        onChange={vi.fn()}
        id="stock"
      />,
    );

    expect(document.getElementById('stock')).toHaveAttribute('type', 'number');
  });

  it('uses a date input for a date member', () => {
    render(
      <FieldControl
        descriptor={descriptor('date')}
        value=""
        onChange={vi.fn()}
        id="when"
      />,
    );

    expect(document.getElementById('when')).toHaveAttribute('type', 'date');
  });

  describe('enum', () => {
    it('renders a select of its allowed values plus a blank option', () => {
      render(
        <FieldControl
          descriptor={descriptor('enum', { enumValues: ['a', 'b'] })}
          value="a"
          onChange={vi.fn()}
        />,
      );

      // The blank option plus the two enum values.
      expect(screen.getAllByRole('option')).toHaveLength(3);
    });

    it('emits the chosen value', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(
        <FieldControl
          descriptor={descriptor('enum', { enumValues: ['a', 'b'] })}
          value="a"
          onChange={onChange}
        />,
      );

      await user.selectOptions(screen.getByRole('combobox'), 'b');

      expect(onChange).toHaveBeenCalledWith('b');
    });

    it('tolerates an enum member with no declared values', () => {
      render(
        <FieldControl
          descriptor={descriptor('enum')}
          value=""
          onChange={vi.fn()}
        />,
      );

      // Only the blank option.
      expect(screen.getAllByRole('option')).toHaveLength(1);
    });
  });

  describe('boolean', () => {
    it('reflects the draft string as a checkbox state', () => {
      render(
        <FieldControl
          descriptor={descriptor('boolean')}
          value="true"
          onChange={vi.fn()}
        />,
      );

      expect(screen.getByRole('checkbox')).toBeChecked();
    });

    it('emits the toggled state as a string', async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(
        <FieldControl
          descriptor={descriptor('boolean')}
          value="false"
          onChange={onChange}
        />,
      );

      await user.click(screen.getByRole('checkbox'));

      expect(onChange).toHaveBeenCalledWith('true');
    });
  });

  it('disables the input for a read-only member', () => {
    render(
      <FieldControl
        descriptor={descriptor('string', { readonly: true })}
        value="x"
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('textbox')).toBeDisabled();
  });

  it.each(['link', 'linkCollection'] as const)(
    'renders a relation (%s) read-only — its editor is a separate control',
    type => {
      render(
        <FieldControl
          descriptor={descriptor(type)}
          value="b-1"
          onChange={vi.fn()}
        />,
      );

      expect(screen.getByRole('textbox')).toBeDisabled();
    },
  );
});
