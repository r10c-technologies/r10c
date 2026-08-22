import {
  accessor,
  type Entity,
  entity,
  type EntityId,
} from '@r10c/entifix-ts-core';
import type { Meta, StoryObj } from '@storybook/react-vite';

import { EntityTable } from './entity-table';

/**
 * A decorated fixture, because the table builds itself from metadata — there is
 * no way to show it without an entity. The `Symbol.metadata` polyfill installs
 * itself on the first import from `@r10c/entifix-ts-core`, so nothing else is
 * needed to make the decorators work here.
 */
@entity({ key: 'story-widget' })
class StoryWidget implements Entity {
  #id?: EntityId;
  #name?: string;
  #stock = 0;

  constructor(id?: EntityId, name?: string, stock = 0) {
    this.#id = id;
    this.#name = name;
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

  @accessor({ type: 'number', label: 'Units in stock' })
  get stock(): number {
    return this.#stock;
  }
  set stock(value: number) {
    this.#stock = value;
  }
}

const WIDGETS = [
  new StoryWidget('w-1', 'Sprocket', 1200),
  new StoryWidget('w-2', 'Flange', 87),
  new StoryWidget('w-3', 'Grommet', 4310),
];

const pager = {
  totalItems: WIDGETS.length,
  currentPage: 1,
  pageSize: 10,
  onPageChange: () => undefined,
};

const meta = {
  title: 'Organisms/EntityTable',
  component: EntityTable,
  tags: ['autodocs'],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof EntityTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <EntityTable<StoryWidget>
      entityConstructor={StoryWidget}
      items={WIDGETS}
      isLoading={false}
      {...pager}
    />
  ),
};

/**
 * The first load. One shimmer cell per visible column rather than a single
 * full-width blob, so the swap to real rows shifts nothing sideways.
 */
export const Loading: Story = {
  render: () => (
    <EntityTable<StoryWidget>
      entityConstructor={StoryWidget}
      items={[]}
      isLoading
      {...pager}
      totalItems={0}
    />
  ),
};

/**
 * A refetch over rows that already arrived keeps them and dims instead. A
 * skeleton here would be a grey flash on every pagination click.
 */
export const Reloading: Story = {
  render: () => (
    <EntityTable<StoryWidget>
      entityConstructor={StoryWidget}
      items={WIDGETS}
      isLoading
      {...pager}
    />
  ),
};

export const Empty: Story = {
  render: () => (
    <EntityTable<StoryWidget>
      entityConstructor={StoryWidget}
      items={[]}
      isLoading={false}
      {...pager}
      totalItems={0}
    />
  ),
};
