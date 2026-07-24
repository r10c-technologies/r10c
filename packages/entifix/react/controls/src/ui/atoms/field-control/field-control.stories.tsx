import type {
  EntityFieldDescriptor,
  MetaAccessorType,
} from '@r10c/entifix-ts-core';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { Stack } from '../../molecules/stack';
import { Button } from '../button';
import { CellValue } from '../cell-value';
import { Text } from '../text';
import { FieldControl } from './field-control';

/** A hand-built descriptor, so the story never instantiates a real entity. */
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

const meta = {
  title: 'Atoms/FieldControl',
  component: FieldControl,
  tags: ['autodocs'],
  // Defaults for the component's required props; every story overrides the
  // rendering through `render`, but the args keep the story types happy.
  args: {
    descriptor: descriptor('string'),
    value: '',
    onChange: () => undefined,
  },
  parameters: {
    docs: {
      description: {
        component:
          'The edit-mode inverse of `CellValue`: it turns one metadata ' +
          'descriptor into the input that edits it. Each story is driven by a ' +
          'hand-built descriptor — the same contract `EntityForm` derives from ' +
          'an entity.',
      },
    },
  },
} satisfies Meta<typeof FieldControl>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Wraps the control in local state so the stories are interactive. */
function Controlled({
  descriptor: fieldDescriptor,
  initial = '',
}: {
  descriptor: EntityFieldDescriptor;
  initial?: string;
}) {
  const [value, setValue] = useState(initial);
  return (
    <Stack gap="2xs">
      <label htmlFor="story-field" className="text-step-sm text-content-muted">
        {fieldDescriptor.label}
      </label>
      <FieldControl
        id="story-field"
        descriptor={fieldDescriptor}
        value={value}
        onChange={setValue}
      />
    </Stack>
  );
}

export const TextField: Story = {
  render: () => (
    <Controlled descriptor={descriptor('string', { label: 'Name' })} initial="Acme" />
  ),
};

export const NumberField: Story = {
  render: () => (
    <Controlled descriptor={descriptor('number', { label: 'Stock' })} initial="1200" />
  ),
};

export const DateField: Story = {
  render: () => (
    <Controlled
      descriptor={descriptor('date', { label: 'Released' })}
      initial="2026-07-20"
    />
  ),
};

export const BooleanField: Story = {
  render: () => (
    <Controlled descriptor={descriptor('boolean', { label: 'Active' })} initial="true" />
  ),
};

export const EnumField: Story = {
  render: () => (
    <Controlled
      descriptor={descriptor('enum', {
        label: 'Tier',
        enumValues: ['bronze', 'silver', 'gold'],
      })}
      initial="silver"
    />
  ),
};

export const ReadOnlyField: Story = {
  render: () => (
    <Controlled
      descriptor={descriptor('string', { label: 'SKU', readonly: true })}
      initial="SKU-001"
    />
  ),
};

export const RelationIsReadOnly: Story = {
  render: () => (
    <Controlled
      descriptor={descriptor('link', { label: 'Brand' })}
      initial="brand-1"
    />
  ),
};

/**
 * The read/edit concept at the field level: `CellValue` renders the value as
 * text, `FieldControl` renders it as an input, and a button flips between them —
 * exactly what `EntityForm` does for a whole record.
 */
export const ReadEditToggle: Story = {
  render: () => {
    const Demo = () => {
      const [editing, setEditing] = useState(false);
      const [value, setValue] = useState('Acme');
      const field = descriptor('string', { label: 'Name' });
      return (
        <Stack gap="xs">
          <Stack direction="row" gap="xs" align="center">
            <Text weight="semibold">Name</Text>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setEditing(current => !current)}
            >
              {editing ? 'View' : 'Edit'}
            </Button>
          </Stack>
          {editing ? (
            <FieldControl descriptor={field} value={value} onChange={setValue} />
          ) : (
            <CellValue value={value} descriptor={field} />
          )}
        </Stack>
      );
    };
    return <Demo />;
  },
};
