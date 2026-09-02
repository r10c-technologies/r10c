import {
  accessor,
  type Entity,
  entity,
  type EntityId,
  type UseCaseDescriptor,
} from '@r10c/entifix-ts-core';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { EntityForm } from './entity-form';

/**
 * A decorated fixture, because the form builds its rows from metadata. The
 * `Symbol.metadata` polyfill installs itself on the first import from
 * `@r10c/entifix-ts-core`, so the decorators need no further setup here.
 */
@entity({ key: 'story-gadget' })
class StoryGadget implements Entity {
  #id?: EntityId;
  #name?: string;
  #code?: string;
  #stock = 0;

  constructor(id?: EntityId, name?: string, code?: string, stock = 0) {
    this.#id = id;
    this.#name = name;
    this.#code = code;
    this.#stock = stock;
  }

  @accessor({ type: 'id', label: 'ID' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'string', label: 'Name' })
  get name(): string | undefined {
    return this.#name;
  }
  set name(value: string | undefined) {
    this.#name = value;
  }

  @accessor({ type: 'string', label: 'Code' })
  get code(): string | undefined {
    return this.#code;
  }
  set code(value: string | undefined) {
    this.#code = value;
  }

  @accessor({ type: 'number', label: 'Units in stock' })
  get stock(): number {
    return this.#stock;
  }
  set stock(value: number) {
    this.#stock = value;
  }
}

const GADGET = new StoryGadget('g-1', 'Sprocket', 'SPR-001', 1200);

/** The draft is a string map, which is what the form reads and writes. */
function Demo({ mode }: { mode: 'read' | 'edit' }) {
  const [values, setValues] = useState<Record<string, string>>({
    id: 'g-1',
    name: 'Sprocket',
    code: 'SPR-001',
    stock: '1200',
  });

  return (
    <EntityForm<StoryGadget>
      entityConstructor={StoryGadget}
      entity={GADGET}
      values={values}
      mode={mode}
      onFieldChange={(name, value) =>
        setValues(current => ({ ...current, [name]: value }))
      }
      onSubmit={() => undefined}
    />
  );
}

const meta = {
  title: 'Organisms/EntityForm',
  component: EntityForm,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof EntityForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Reading: Story = { render: () => <Demo mode="read" /> };

export const Editing: Story = { render: () => <Demo mode="edit" /> };

/**
 * The record is still in flight. One label+control pair per resolved field —
 * and it *replaces* the rows rather than stacking above them, which is what a
 * loading form used to do.
 */
export const Loading: Story = {
  render: () => (
    <EntityForm<StoryGadget> entityConstructor={StoryGadget} isLoading />
  ),
};

/** A declared verb, as the service reports it after filtering by permission. */
const verb = (
  key: string,
  placement: 'context-independent' | 'determining',
  destructive = false,
) => ({
  key,
  binding: 'entity' as const,
  placement,
  labelKey: `entity:user-identity.useCases.${key}`,
  ...(destructive
    ? {
        confirm: {
          tone: 'destructive' as const,
          messageKey: 'entity:user-identity.useCases.revokeSessionsConfirm',
        },
      }
    : {}),
});

function ActionsDemo({ useCases }: { useCases: UseCaseDescriptor[] }) {
  const [values, setValues] = useState<Record<string, string>>({
    id: 'g-1',
    name: 'Sprocket',
    code: 'SPR-001',
    stock: '1200',
  });

  return (
    <EntityForm<StoryGadget>
      entityConstructor={StoryGadget}
      entity={GADGET}
      values={values}
      mode="edit"
      onFieldChange={(name, value) =>
        setValues(current => ({ ...current, [name]: value }))
      }
      onSubmit={() => undefined}
      onDelete={() => undefined}
      onClone={() => undefined}
      metadata={{ actions: ['read', 'write', 'delete'], useCases }}
      onUseCase={() => undefined}
    />
  );
}

/**
 * The verbs an entity declares, placed by the served descriptor:
 * `context-independent` sits beside the title, `determining` finalizes the page
 * from the footer. A destructive one asks before it fires.
 */
export const DeclaredActions: Story = {
  render: () => (
    <ActionsDemo
      useCases={[
        verb('revokeSessions', 'context-independent', true),
        verb('updateAspects', 'determining'),
      ]}
    />
  ),
};

/**
 * Four fit a row; twelve do not. The fifth and beyond fold into one overflow
 * menu, in **declaration order** — the entity's author decided which verbs
 * matter by writing them first.
 */
export const OverflowActions: Story = {
  render: () => (
    <ActionsDemo
      useCases={[
        ...Array.from({ length: 4 }, (_unused, index) =>
          verb(`verb${index}`, 'context-independent'),
        ),
        verb('revokeSessions', 'context-independent', true),
        verb('updateAspects', 'context-independent'),
      ]}
    />
  ),
};

/**
 * Absent metadata is the un-migrated call site, and it renders exactly as it did
 * before ADR 0026: Save and Delete unconditional, no declared verbs. Hiding a
 * button protects nothing either way — the route guard is the boundary.
 */
export const WithoutMetadata: Story = { render: () => <Demo mode="edit" /> };
