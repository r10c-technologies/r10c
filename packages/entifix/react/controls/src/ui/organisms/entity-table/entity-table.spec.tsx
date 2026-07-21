import {
  accessor,
  type Entity,
  entity,
  type EntityId,
  EntityLink,
} from '@r10c/entifix-ts-core';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Effect } from 'effect';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UiPreferencesProvider } from '../../../preferences/ui-preferences-context';
import type { UiPreferencesStore } from '../../../preferences/ui-preferences-store';
import { EntityTable } from './entity-table';
import {
  EntityColumn,
  EntityTableHeader,
  EntityTableRow,
  EntityTableToolbar,
} from './entity-table-slots';

@entity({ key: 'widget-brand' })
class WidgetBrand implements Entity {
  #id?: EntityId;
  #name?: string;

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

@entity({ key: 'widget' })
class Widget implements Entity {
  #id?: EntityId;
  #name?: string;
  #stock = 0;
  #brand = new EntityLink(WidgetBrand);

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

  @accessor({ type: 'link', label: 'Brand' })
  get brand(): EntityLink<WidgetBrand> {
    return this.#brand;
  }
}

function makeWidget(): Widget {
  const brand = new WidgetBrand();
  brand.id = 'brand-1';
  brand.name = 'Acme';

  const widget = new Widget();
  widget.id = 'widget-1';
  widget.name = 'Sprocket';
  widget.stock = 1200;
  widget.brand.setValue(brand);
  return widget;
}

const pager = {
  isLoading: false,
  totalItems: 1,
  currentPage: 1,
  pageSize: 10,
  onPageChange: () => undefined,
};

describe('EntityTable', () => {
  beforeEach(() => window.localStorage.clear());

  it('builds its columns from the entity metadata', () => {
    render(
      <EntityTable
        entityConstructor={Widget}
        items={[makeWidget()]}
        {...pager}
      />,
    );

    // Declared labels, not accessor names.
    expect(screen.getAllByText('Units in stock').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Brand').length).toBeGreaterThan(0);
  });

  it('formats values by their declared type', () => {
    render(
      <EntityTable
        entityConstructor={Widget}
        items={[makeWidget()]}
        {...pager}
      />,
    );

    // A number is localized, and a loaded link reads as its target's label.
    expect(screen.getAllByText('1,200').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Acme').length).toBeGreaterThan(0);
  });

  it('renders a foreign-key link as its id when the target is not loaded', () => {
    const widget = makeWidget();
    widget.brand.setValue(undefined);
    widget.brand.setId('brand-9');

    render(
      <EntityTable entityConstructor={Widget} items={[widget]} {...pager} />,
    );

    expect(screen.getAllByText('brand-9').length).toBeGreaterThan(0);
  });

  it('lets a slot override a column', () => {
    render(
      <EntityTable entityConstructor={Widget} items={[makeWidget()]} {...pager}>
        <EntityColumn<Widget>
          field="brand"
          label="Maker"
          render={widget => <b>{widget.brand.value?.name} Inc.</b>}
        />
      </EntityTable>,
    );

    expect(screen.getAllByText('Maker').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Acme Inc.').length).toBeGreaterThan(0);
  });

  it('reports an empty result set', () => {
    render(
      <EntityTable
        entityConstructor={Widget}
        items={[]}
        {...pager}
        totalItems={0}
      />,
    );

    expect(screen.getAllByText('No records').length).toBeGreaterThan(0);
  });
});

describe('EntityTable controls', () => {
  beforeEach(() => window.localStorage.clear());

  const renderTable = (
    props: Partial<Parameters<typeof EntityTable<Widget>>[0]> = {},
    children?: ReactNode,
  ) => {
    const user = userEvent.setup();
    render(
      <EntityTable<Widget>
        entityConstructor={Widget}
        items={[makeWidget()]}
        {...pager}
        {...props}
      >
        {children}
      </EntityTable>,
    );
    return { user };
  };

  it('shows the toolbar and pager by default', () => {
    renderTable();

    expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Columns' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
  });

  // A table embedded in a form or a picker has no room for the toolbar, and
  // its caller owns paging.
  it('hides the controls on request', () => {
    renderTable({ showControls: false });

    expect(screen.queryByRole('button', { name: 'Filters' })).not.toBeInTheDocument();
  });

  it('opens and closes the filter panel', async () => {
    const { user } = renderTable();

    await user.click(screen.getByRole('button', { name: 'Filters' }));
    expect(screen.getByRole('button', { name: 'Add filter' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Filters' }));
    expect(screen.queryByRole('button', { name: 'Add filter' })).not.toBeInTheDocument();
  });

  // The two panels share one slot, so opening one has to close the other
  // rather than stacking them.
  it('swaps the filter panel for the sorting panel', async () => {
    const { user } = renderTable();
    await user.click(screen.getByRole('button', { name: 'Filters' }));

    await user.click(screen.getByRole('button', { name: 'Sorting' }));

    expect(screen.getByRole('button', { name: 'Add sort' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add filter' })).not.toBeInTheDocument();
  });

  it('reports the filtering the panel produced', async () => {
    const onFilteringChange = vi.fn();
    const { user } = renderTable({ onFilteringChange });
    await user.click(screen.getByRole('button', { name: 'Filters' }));

    await user.click(screen.getByRole('button', { name: 'Add filter' }));

    expect(onFilteringChange).toHaveBeenCalledWith({ operator: 'and', values: [] });
  });

  it('reports the sorting the panel produced', async () => {
    const onSortingChange = vi.fn();
    const { user } = renderTable({ onSortingChange });
    await user.click(screen.getByRole('button', { name: 'Sorting' }));

    await user.click(screen.getByRole('button', { name: 'Add sort' }));

    expect(onSortingChange).toHaveBeenCalled();
  });

  it('tolerates panels with no callback wired', async () => {
    const { user } = renderTable();
    await user.click(screen.getByRole('button', { name: 'Filters' }));

    await user.click(screen.getByRole('button', { name: 'Add filter' }));

    expect(screen.getByLabelText('Filter member')).toBeInTheDocument();
  });

  it('offers only filterable and sortable members in the panels', async () => {
    const { user } = renderTable();

    await user.click(screen.getByRole('button', { name: 'Filters' }));
    await user.click(screen.getByRole('button', { name: 'Add filter' }));

    // `id` and links default to neither sortable nor filterable.
    expect(screen.queryByRole('option', { name: 'ID' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Name' })).toBeInTheDocument();
  });

  describe('record links', () => {
    it('adds an actions column when a record href is given', () => {
      renderTable({ hrefFor: (id) => `/widget/${String(id)}` });

      expect(screen.getByRole('columnheader', { name: 'Actions' })).toBeInTheDocument();
      expect(screen.getAllByRole('link', { name: 'Open' })[0]).toHaveAttribute(
        'href',
        '/widget/widget-1',
      );
    });

    it('omits the actions column without one', () => {
      renderTable();

      expect(
        screen.queryByRole('columnheader', { name: 'Actions' }),
      ).not.toBeInTheDocument();
    });

    it('offers a create link when a new href is given', () => {
      renderTable({ newHref: '/widget/new' });

      expect(screen.getByRole('link', { name: 'New' })).toHaveAttribute(
        'href',
        '/widget/new',
      );
    });
  });

  describe('empty and loading states', () => {
    it('reports loading before the first page arrives', () => {
      renderTable({ items: [], isLoading: true });

      expect(screen.getAllByText('Loading…').length).toBeGreaterThan(0);
    });

    // A reload of an already-populated table keeps showing the rows rather
    // than blanking them.
    it('keeps showing rows while reloading', () => {
      renderTable({ isLoading: true });

      expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
      expect(screen.getAllByText('Sprocket').length).toBeGreaterThan(0);
    });

    it('reports an empty result set', () => {
      renderTable({ items: [], totalItems: 0 });

      expect(screen.getAllByText('No records').length).toBeGreaterThan(0);
    });
  });

  describe('the responsive pivot', () => {
    // Both layouts render and CSS picks one: a JS breakpoint hook would have to
    // guess during SSR and correct after mount — a hydration mismatch on every
    // page load.
    it.each([
      ['sm', 'hidden sm:block', 'sm:hidden'],
      ['md', 'hidden md:block', 'md:hidden'],
      ['lg', 'hidden lg:block', 'lg:hidden'],
    ] as const)('renders both layouts at the %s breakpoint', (breakpoint, grid, cards) => {
      const { container } = render(
        <EntityTable<Widget>
          entityConstructor={Widget}
          items={[makeWidget()]}
          pivotBreakpoint={breakpoint}
          {...pager}
        />,
      );

      expect(container.querySelector(`.${grid.replace(' ', '.').replace(':', '\\:')}`))
        .toBeTruthy();
      expect(container.innerHTML).toContain(cards);
    });

    it('renders each row twice — once per layout', () => {
      renderTable();

      expect(screen.getAllByText('Sprocket')).toHaveLength(2);
    });
  });

  describe('slots', () => {
    it('replaces the whole header row', () => {
      renderTable({}, <EntityTableHeader render={() => <tr><th>Custom header</th></tr>} />);

      expect(screen.getByRole('columnheader', { name: 'Custom header' })).toBeInTheDocument();
      expect(
        screen.queryByRole('columnheader', { name: 'Units in stock' }),
      ).not.toBeInTheDocument();
    });

    it('replaces the whole body row', () => {
      renderTable(
        {},
        <EntityTableRow render={(item) => <tr><td>{`Row ${String(item.id)}`}</td></tr>} />,
      );

      expect(screen.getByText('Row widget-1')).toBeInTheDocument();
    });

    it('adds toolbar actions alongside the built-in ones', () => {
      renderTable({}, <EntityTableToolbar><button type="button">Export</button></EntityTableToolbar>);

      expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Columns' })).toBeInTheDocument();
    });

    it('renders unrecognised children below the table', () => {
      renderTable({}, <p>A footnote</p>);

      expect(screen.getByText('A footnote')).toBeInTheDocument();
    });

    it('uses a custom cell renderer in both layouts', () => {
      renderTable({}, <EntityColumn<Widget> field="name" render={(item) => `!${String(item.name)}`} />);

      expect(screen.getAllByText('!Sprocket')).toHaveLength(2);
    });
  });

  describe('personalization', () => {
    it('hides a column through the settings panel', async () => {
      const { user } = renderTable();
      await user.click(screen.getByRole('button', { name: 'Columns' }));

      await user.click(screen.getByLabelText('Units in stock'));

      await waitFor(() =>
        expect(
          screen.queryByRole('columnheader', { name: 'Units in stock' }),
        ).not.toBeInTheDocument(),
      );
    });

    it('reorders columns through the settings panel', async () => {
      const { user } = renderTable();
      await user.click(screen.getByRole('button', { name: 'Columns' }));

      await user.click(screen.getByRole('button', { name: 'Move Name up' }));

      await waitFor(() =>
        expect(
          screen.getAllByRole('columnheader').map((cell) => cell.textContent),
        ).toEqual(['Name', 'ID', 'Units in stock', 'Brand']),
      );
    });
  });
});

describe('EntityTable keying and personalization scope', () => {
  beforeEach(() => window.localStorage.clear());

  // Rows are keyed by id; an entity that has not been saved yet has none, so
  // the list position stands in rather than every row sharing key "undefined".
  it('renders items that carry no id', () => {
    const unsaved = new Widget();
    unsaved.name = 'Draft';

    render(
      <EntityTable<Widget>
        entityConstructor={Widget}
        items={[unsaved]}
        {...pager}
      />,
    );

    expect(screen.getAllByText('Draft').length).toBeGreaterThan(0);
  });

  it('renders custom rows for items that carry no id', () => {
    const unsaved = new Widget();
    unsaved.name = 'Draft';

    render(
      <EntityTable<Widget> entityConstructor={Widget} items={[unsaved]} {...pager}>
        <EntityTableRow<Widget> render={(item) => <tr><td>{`Row ${String(item.name)}`}</td></tr>} />
      </EntityTable>,
    );

    expect(screen.getByText('Row Draft')).toBeInTheDocument();
  });

  // Two tables over the same entity — a picker and a full listing, say — need
  // separate layouts, which is what the explicit key is for.
  it('scopes personalization to an explicit preferences key', async () => {
    const user = userEvent.setup();
    const written: string[] = [];
    const store: UiPreferencesStore = {
      read: () => Effect.succeed(undefined),
      write: (key) => Effect.sync(() => void written.push(key)),
      remove: () => Effect.void,
    };
    render(
      <UiPreferencesProvider store={store}>
        <EntityTable<Widget>
          entityConstructor={Widget}
          items={[makeWidget()]}
          preferencesKey="widget-picker"
          {...pager}
        />
      </UiPreferencesProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Columns' }));
    await user.click(screen.getByLabelText('Units in stock'));

    await waitFor(() => expect(written).toEqual(['entity-table:widget-picker']));
  });

  it('adds a computed column that the entity has no member for', () => {
    render(
      <EntityTable<Widget> entityConstructor={Widget} items={[makeWidget()]} {...pager}>
        <EntityColumn field="margin" render={() => 'computed'} />
      </EntityTable>,
    );

    expect(screen.getByRole('columnheader', { name: 'margin' })).toBeInTheDocument();
    expect(screen.getAllByText('computed')).toHaveLength(2);
  });
});

describe('EntityTable defaults', () => {
  beforeEach(() => window.localStorage.clear());

  it('closes the sorting panel when its button is pressed again', async () => {
    const user = userEvent.setup();
    render(
      <EntityTable<Widget> entityConstructor={Widget} items={[makeWidget()]} {...pager} />,
    );

    await user.click(screen.getByRole('button', { name: 'Sorting' }));
    expect(screen.getByRole('button', { name: 'Add sort' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sorting' }));

    expect(screen.queryByRole('button', { name: 'Add sort' })).not.toBeInTheDocument();
  });

  // Personalization is scoped by the entity `key`, falling back to the class
  // name — so an entity that declares no key still gets its own layout rather
  // than sharing one keyed "undefined".
  it('scopes personalization by the class name when the entity declares no key', async () => {
    @entity()
    class Unkeyed implements Entity {
      #id?: EntityId;

      @accessor({ type: 'id' })
      get id(): EntityId {
        return this.#id;
      }
      set id(value: EntityId) {
        this.#id = value;
      }
    }

    const user = userEvent.setup();
    const written: string[] = [];
    const store: UiPreferencesStore = {
      read: () => Effect.succeed(undefined),
      write: (key) => Effect.sync(() => void written.push(key)),
      remove: () => Effect.void,
    };
    render(
      <UiPreferencesProvider store={store}>
        <EntityTable<Unkeyed> entityConstructor={Unkeyed} items={[]} {...pager} />
      </UiPreferencesProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Columns' }));
    await user.click(screen.getByRole('button', { name: 'Reset to default' }));

    await waitFor(() => expect(written).toEqual(['entity-table:Unkeyed']));
  });
});
