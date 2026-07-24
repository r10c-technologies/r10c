'use client';

import type {
  EntityFieldDescriptor,
  MetaAccessorType,
} from '@r10c/entifix-ts-core';

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
 * A relation (`link`/`linkCollection`) is rendered read-only here — editing one
 * needs a dedicated picker, a separate control — so a form composes that in
 * through a slot rather than getting a broken text box by default.
 */
export function FieldControl({
  descriptor,
  value,
  onChange,
  id,
}: FieldControlProps) {
  const disabled =
    descriptor.readonly ||
    descriptor.type === 'link' ||
    descriptor.type === 'linkCollection';

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
            {option}
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
