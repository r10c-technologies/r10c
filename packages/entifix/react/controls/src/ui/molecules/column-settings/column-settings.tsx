'use client';

import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react';

import { Button } from '../../atoms/button';
import { Checkbox } from '../../atoms/field';
import { Text } from '../../atoms/text';

/**
 * The user's column layout for one table. Stored through the UI-preferences
 * port, so it is deliberately plain JSON: names only, no descriptors — a column
 * that disappears from the entity simply stops matching.
 */
export interface ColumnPersonalization {
  /** Column names, most-significant first. Unlisted columns keep their default
   *  position at the end, so a new entity member never breaks a saved layout. */
  order?: string[];
  /** Column names the user hid. */
  hidden?: string[];
}

export interface ColumnSettingsColumn {
  name: string;
  label: string;
}

export interface ColumnSettingsProps {
  /** Columns in their currently resolved order. */
  columns: readonly ColumnSettingsColumn[];
  hidden: readonly string[];
  onChange: (next: ColumnPersonalization) => void;
}

function move(names: readonly string[], from: number, to: number): string[] {
  const next = [...names];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * Popover for reordering and hiding columns. Reordering uses explicit up/down
 * buttons rather than drag-and-drop: it needs no dependency, works on touch, and
 * is keyboard-operable for free.
 */
export function ColumnSettings({
  columns,
  hidden,
  onChange,
}: ColumnSettingsProps) {
  const order = columns.map(column => column.name);

  const toggle = (name: string) =>
    onChange({
      order,
      hidden: hidden.includes(name)
        ? hidden.filter(entry => entry !== name)
        : [...hidden, name],
    });

  const shift = (index: number, delta: number) => {
    const target = index + delta;
    // Defence in depth: the buttons are already disabled at both ends, so this
    // is unreachable through the UI — but an out-of-range splice would silently
    // corrupt the order rather than no-op.
    /* v8 ignore next */
    if (target < 0 || target >= order.length) return;
    onChange({ order: move(order, index, target), hidden: [...hidden] });
  };

  return (
    <Popover className="relative">
      <PopoverButton as={Button} type="button" variant="secondary" size="sm">
        Columns
      </PopoverButton>
      <PopoverPanel
        anchor="bottom end"
        className="z-10 mt-3xs w-64 rounded-xl border border-border bg-surface-elevated p-2xs shadow-card"
      >
        <Text step={-2} tone="muted" className="px-3xs pb-3xs">
          Visibility and order
        </Text>
        <ul className="flex flex-col gap-3xs">
          {columns.map((column, index) => (
            <li
              key={column.name}
              className="flex items-center justify-between gap-2xs px-3xs"
            >
              <Checkbox
                label={column.label}
                checked={!hidden.includes(column.name)}
                onChange={() => toggle(column.name)}
              />
              <span className="flex gap-3xs">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Move ${column.label} up`}
                  disabled={index === 0}
                  onClick={() => shift(index, -1)}
                >
                  ↑
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Move ${column.label} down`}
                  disabled={index === columns.length - 1}
                  onClick={() => shift(index, 1)}
                >
                  ↓
                </Button>
              </span>
            </li>
          ))}
        </ul>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-2xs w-full"
          onClick={() => onChange({})}
        >
          Reset to default
        </Button>
      </PopoverPanel>
    </Popover>
  );
}
