import {
  accessor,
  type Entity,
  entity,
  type EntityFieldDescriptor,
  type EntityId,
  type EntityLinkSource,
} from '@r10c/entifix-ts-core';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';

import { EntityLinkInput } from './entity-link-input';

@entity({ key: 'story-brand' })
class StoryBrand implements Entity {
  #id?: EntityId;
  #name?: string;

  constructor(id?: EntityId, name?: string) {
    this.#id = id;
    this.#name = name;
  }

  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ type: 'string' })
  get name(): string | undefined {
    return this.#name;
  }
  set name(value: string | undefined) {
    this.#name = value;
  }
}

const BRANDS = [
  new StoryBrand('b-1', 'Acme'),
  new StoryBrand('b-2', 'Globex'),
  new StoryBrand('b-3', 'Initech'),
];

const descriptor: EntityFieldDescriptor = {
  name: 'brand',
  key: 'brand',
  label: 'Brand',
  type: 'link',
  sortable: false,
  filterable: false,
  order: 0,
  readonly: false,
  required: false,
  linkLabelProperty: 'name',
  linkSearchProperty: 'name',
  linkSerialization: 'id',
};

/**
 * The source is a literal here — no provider, no server, no adapter. Storybook
 * can drive the editor at all because `EntityLinkSource` is plain data plus
 * callbacks; anything else would mean the story needed the integration layer.
 */
function Demo({ disabled = false }: { disabled?: boolean }) {
  const [value, setValue] = useState('');
  const [selected, setSelected] = useState<StoryBrand | undefined>(undefined);
  const [term, setTerm] = useState('');
  const [isOpen, setOpen] = useState(false);

  const matches = BRANDS.filter(brand =>
    (brand.name ?? '').toLowerCase().includes(term.toLowerCase()),
  );

  const source: EntityLinkSource<StoryBrand> = {
    entityConstructor: StoryBrand,
    labelOf: brand => brand.name ?? String(brand.id),
    selected: { label: selected?.name, isLoading: false },
    quick: { term, setTerm, options: matches, isLoading: false },
    browse: {
      items: BRANDS,
      totalItems: BRANDS.length,
      currentPage: 1,
      pageSize: 10,
      isLoading: false,
      onPageChange: () => undefined,
      onPageSizeChange: () => undefined,
      onFilteringChange: () => undefined,
      onSortingChange: () => undefined,
      isOpen,
      open: () => setOpen(true),
      close: () => setOpen(false),
    },
  };

  return (
    <div className="max-w-md">
      <EntityLinkInput<StoryBrand>
        descriptor={descriptor}
        value={value}
        source={source}
        disabled={disabled}
        onSelect={brand => {
          setSelected(brand);
          setValue(String(brand.id));
        }}
        onClear={() => {
          setSelected(undefined);
          setValue('');
        }}
      />
    </div>
  );
}

const meta = {
  title: 'Molecules/EntityLinkInput',
  component: EntityLinkInput,
  tags: ['autodocs'],
} satisfies Meta<typeof EntityLinkInput>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Type to filter, or open the dialog for the whole catalog. */
export const Editable: Story = {
  render: () => <Demo />,
};

/** A read-only relation still reads, it just cannot be changed. */
export const Disabled: Story = {
  render: () => <Demo disabled />,
};
