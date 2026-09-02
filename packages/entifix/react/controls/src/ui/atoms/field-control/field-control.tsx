'use client';

import type {
  EntityFieldDescriptor,
  MetaAccessorType,
} from '@r10c/entifix-ts-core';

import { useEnumLabel } from '../../../i18n';
import { Checkbox, Select, TextInput } from '../field';

export interface FieldControlProps {
  descriptor: EntityFieldDescriptor;
  /**
   * The draft value as a string — the shape a native input round-trips. A form
   * holds its whole draft as `Record<string, string>` and reconstructs typed
   * values only at submit, so the control never sees a domain value.
   */
  value: string;
  onChange: (value: string) => void;
  id?: string;
}

/** Native input type for the text-like controls; text is the default. */
const INPUT_TYPE: Partial<Record<MetaAccessorType, string>> = {
  number: 'number',
  date: 'date',
};

/**
 * The edit-mode inverse of {@link CellValue}: it turns one metadata descriptor
 * into the input that edits it. Centralizing the type→control choice is what
 * lets a form stay generic, the same way `CellValue` keeps a table generic.
 *
 * A relation (`link`/`linkCollection`) is rendered read-only here, deliberately:
 * editing one needs a picker that can search and page the target, which is a
 * different control with different dependencies. So this atom stays a pure
 * type→input map and a relation never falls back to a broken text box.
 *
 * For a to-one `link` that is only half the story — `EntityForm` wires the
 * picker in one level up from its `linkSources`, so the member does get an
 * editor, just not from here. A `linkCollection` has no editor anywhere yet
 * (#26), and read-only is all it gets. A `composition` is the same: its rows
 * need a detail grid (#122), and a text box holding `[object Object]` would be
 * strictly worse than an honest disabled field.
 *
 * A `scalarCollection` is the exception among the collections and falls through
 * to the plain text input on purpose: a `string[]` has a lossless comma form,
 * so the draft it round-trips through *is* editable text. Splitting on the
 * comma is `reconstructEntity`'s half of that same contract.
 */
export function FieldControl({
  descriptor,
  value,
  onChange,
  id,
}: FieldControlProps) {
  const enumLabel = useEnumLabel();
  const disabled =
    descriptor.readonly ||
    descriptor.type === 'link' ||
    descriptor.type === 'linkCollection' ||
    descriptor.type === 'composition';

  if (descriptor.type === 'boolean') {
    return (
      <Checkbox
        id={id}
        label={descriptor.label}
        checked={value === 'true'}
        disabled={disabled}
        onChange={event => onChange(String(event.currentTarget.checked))}
      />
    );
  }

  if (descriptor.type === 'enum') {
    return (
      <Select
        id={id}
        value={value}
        disabled={disabled}
        onChange={event => onChange(event.currentTarget.value)}
      >
        <option value="">—</option>
        {(descriptor.enumValues ?? []).map(option => (
          <option key={option} value={option}>
            {enumLabel(descriptor, option)}
          </option>
        ))}
      </Select>
    );
  }

  return (
    <TextInput
      id={id}
      type={INPUT_TYPE[descriptor.type] ?? 'text'}
      value={value}
      disabled={disabled}
      onChange={event => onChange(event.currentTarget.value)}
    />
  );
}
