import {
  accessor,
  EntifixConnError,
  type Entity,
  entity,
  type EntityId,
  EntityLink,
} from '@r10c/entifix-ts-core';
import { makeFormatters } from '@r10c/entifix-ts-i18n';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Effect } from 'effect';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { UiPreferencesProvider } from '../../../preferences/ui-preferences-context';
import type { UiPreferencesState } from '../../../preferences/ui-preferences-state';
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
    expect(
      screen.getAllByText(makeFormatters('es').number(1200)).length,
    ).toBeGreaterThan(0);
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

    expect(screen.getAllByText('Sin registros').length).toBeGreaterThan(0);
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

    expect(screen.getByRole('button', { name: 'Filtros' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Columnas' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeInTheDocument();
  });

  // A table embedded in a form or a picker has no room for the toolbar, and
  // its caller owns paging.
  it('hides the controls on request', () => {
    renderTable({ showControls: false });

    expect(
      screen.queryByRole('button', { name: 'Filtros' }),
    ).not.toBeInTheDocument();
  });

  it('opens and closes the filter panel', async () => {
    const { user } = renderTable();

    await user.click(screen.getByRole('button', { name: 'Filtros' }));
    expect(
      screen.getByRole('button', { name: 'Añadir filtro' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Filtros' }));
    expect(
      screen.queryByRole('button', { name: 'Añadir filtro' }),
    ).not.toBeInTheDocument();
  });

  // The two panels share one slot, so opening one has to close the other
  // rather than stacking them.
  it('swaps the filter panel for the sorting panel', async () => {
    const { user } = renderTable();
    await user.click(screen.getByRole('button', { name: 'Filtros' }));

    await user.click(screen.getByRole('button', { name: 'Orden' }));

    expect(
      screen.getByRole('button', { name: 'Añadir orden' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Añadir filtro' }),
    ).not.toBeInTheDocument();
  });

  // The panels commit rather than stream: the value feeds a load request, so
  // it must not be reported while the user is still composing it.
  it('reports the filtering only once the panel is applied', async () => {
    const onFilteringChange = vi.fn();
    const { user } = renderTable({ onFilteringChange });
    await user.click(screen.getByRole('button', { name: 'Filtros' }));

    await user.click(screen.getByRole('button', { name: 'Añadir filtro' }));
    expect(onFilteringChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Aplicar filtros' }));

    expect(onFilteringChange).toHaveBeenCalledWith({
      operator: 'and',
      values: [],
    });
  });

  it('reports the sorting only once the panel is applied', async () => {
    const onSortingChange = vi.fn();
    const { user } = renderTable({ onSortingChange });
    await user.click(screen.getByRole('button', { name: 'Orden' }));

    await user.click(screen.getByRole('button', { name: 'Añadir orden' }));
    expect(onSortingChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Aplicar orden' }));

    expect(onSortingChange).toHaveBeenCalled();
  });

  it('seeds the filter panel from the applied filtering', async () => {
    const { user } = renderTable({
      filtering: {
        operator: 'or',
        values: [{ property: 'name', operator: 'like', value: 'Acme' }],
      },
    });

    await user.click(screen.getByRole('button', { name: 'Filtros' }));

    expect(screen.getByLabelText('Valor del filtro')).toHaveValue('Acme');
    expect(screen.getByLabelText('Coincidir todos o cualquiera de los filtros')).toHaveValue('or');
  });

  it('seeds the sort panel from the applied sorting', async () => {
    const { user } = renderTable({
      sorting: { 0: { property: 'name', type: 'desc' } },
    });

    await user.click(screen.getByRole('button', { name: 'Orden' }));

    expect(screen.getByLabelText('Dirección de orden')).toHaveValue('desc');
  });

  it('tolerates panels with no callback wired', async () => {
    const { user } = renderTable();
    await user.click(screen.getByRole('button', { name: 'Filtros' }));

    await user.click(screen.getByRole('button', { name: 'Añadir filtro' }));

    expect(screen.getByLabelText('Miembro del filtro')).toBeInTheDocument();
  });

  it('offers only filterable and sortable members in the panels', async () => {
    const { user } = renderTable();

    await user.click(screen.getByRole('button', { name: 'Filtros' }));
    await user.click(screen.getByRole('button', { name: 'Añadir filtro' }));

    // `id` and links default to neither sortable nor filterable.
    expect(
      screen.queryByRole('option', { name: 'ID' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Name' })).toBeInTheDocument();
  });

  describe('record links', () => {
    it('adds an actions column when a record href is given', () => {
      renderTable({ hrefFor: id => `/widget/${String(id)}` });

      expect(
        screen.getByRole('columnheader', { name: 'Acciones' }),
      ).toBeInTheDocument();
      expect(screen.getAllByRole('link', { name: 'Abrir' })[0]).toHaveAttribute(
        'href',
        '/widget/widget-1',
      );
    });

    it('omits the actions column without one', () => {
      renderTable();

      expect(
        screen.queryByRole('columnheader', { name: 'Acciones' }),
      ).not.toBeInTheDocument();
    });

    it('picks a row instead of navigating when a selection handler is given', async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      renderTable({ onSelect });

      await user.click(
        screen.getAllByRole('button', { name: 'Seleccionar' })[0]!,
      );

      expect(onSelect).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'widget-1' }),
      );
    });

    // Inside a picker the user is choosing a value; offering to navigate away
    // from the form they came from would be the wrong affordance.
    it('prefers selection over navigation when both are given', () => {
      renderTable({ onSelect: vi.fn(), hrefFor: id => `/widget/${String(id)}` });

      expect(
        screen.queryByRole('link', { name: 'Abrir' }),
      ).not.toBeInTheDocument();
      expect(
        screen.getAllByRole('button', { name: 'Seleccionar' }).length,
      ).toBeGreaterThan(0);
    });

    it('offers a create link when a new href is given', () => {
      renderTable({ newHref: '/widget/new' });

      expect(screen.getByRole('link', { name: 'Nuevo' })).toHaveAttribute(
        'href',
        '/widget/new',
      );
    });
  });

  describe('empty and loading states', () => {
    it('reports loading before the first page arrives', () => {
      renderTable({ items: [], isLoading: true });

      expect(screen.getAllByText('Cargando…').length).toBeGreaterThan(0);
    });

    // A reload of an already-populated table keeps showing the rows rather
    // than blanking them.
    it('keeps showing rows while reloading', () => {
      renderTable({ isLoading: true });

      expect(screen.queryByText('Cargando…')).not.toBeInTheDocument();
      expect(screen.getAllByText('Sprocket').length).toBeGreaterThan(0);
    });

    it('reports an empty result set', () => {
      renderTable({ items: [], totalItems: 0 });

      expect(screen.getAllByText('Sin registros').length).toBeGreaterThan(0);
    });
  });

  describe('the failure state', () => {
    const unreachable = new EntifixConnError('the catalog is unreachable');

    it('announces the failure', () => {
      renderTable({ items: [], totalItems: 0, error: unreachable });

      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('the catalog is unreachable');
    });

    // The whole point: "Sin registros" after a failed load tells the user their
    // catalog is empty, which is the one conclusion they must not draw.
    it('does not claim the result set is empty', () => {
      renderTable({ items: [], totalItems: 0, error: unreachable });

      expect(screen.queryByText('Sin registros')).not.toBeInTheDocument();
      expect(
        screen.getAllByText('No se pudieron cargar los registros').length,
      ).toBeGreaterThan(0);
    });

    // A refetch that fails leaves the previous page on screen; without the
    // alert the user would read stale rows as current.
    it('flags stale rows when a reload fails', () => {
      renderTable({ error: unreachable });

      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getAllByText('Sprocket').length).toBeGreaterThan(0);
    });

    it('stays silent when nothing failed', () => {
      renderTable();

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
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
    ] as const)(
      'renders both layouts at the %s breakpoint',
      (breakpoint, grid, cards) => {
        const { container } = render(
          <EntityTable<Widget>
            entityConstructor={Widget}
            items={[makeWidget()]}
            pivotBreakpoint={breakpoint}
            {...pager}
          />,
        );

        expect(
          container.querySelector(
            `.${grid.replace(' ', '.').replace(':', '\\:')}`,
          ),
        ).toBeTruthy();
        expect(container.innerHTML).toContain(cards);
      },
    );

    it('renders each row twice — once per layout', () => {
      renderTable();

      expect(screen.getAllByText('Sprocket')).toHaveLength(2);
    });
  });

  describe('slots', () => {
    it('replaces the whole header row', () => {
      renderTable(
        {},
        <EntityTableHeader
          render={() => (
            <tr>
              <th>Custom header</th>
            </tr>
          )}
        />,
      );

      expect(
        screen.getByRole('columnheader', { name: 'Custom header' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('columnheader', { name: 'Units in stock' }),
      ).not.toBeInTheDocument();
    });

    it('replaces the whole body row', () => {
      renderTable(
        {},
        <EntityTableRow
          render={item => (
            <tr>
              <td>{`Row ${String(item.id)}`}</td>
            </tr>
          )}
        />,
      );

      expect(screen.getByText('Row widget-1')).toBeInTheDocument();
    });

    it('adds toolbar actions alongside the built-in ones', () => {
      renderTable(
        {},
        <EntityTableToolbar>
          <button type="button">Export</button>
        </EntityTableToolbar>,
      );

      expect(
        screen.getByRole('button', { name: 'Export' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Columnas' }),
      ).toBeInTheDocument();
    });

    it('renders unrecognised children below the table', () => {
      renderTable({}, <p>A footnote</p>);

      expect(screen.getByText('A footnote')).toBeInTheDocument();
    });

    it('uses a custom cell renderer in both layouts', () => {
      renderTable(
        {},
        <EntityColumn<Widget>
          field="name"
          render={item => `!${String(item.name)}`}
        />,
      );

      expect(screen.getAllByText('!Sprocket')).toHaveLength(2);
    });
  });

  describe('personalization', () => {
    it('hides a column through the settings panel', async () => {
      const { user } = renderTable();
      await user.click(screen.getByRole('button', { name: 'Columnas' }));

      await user.click(screen.getByLabelText('Units in stock'));

      await waitFor(() =>
        expect(
          screen.queryByRole('columnheader', { name: 'Units in stock' }),
        ).not.toBeInTheDocument(),
      );
    });

    it('reorders columns through the settings panel', async () => {
      const { user } = renderTable();
      await user.click(screen.getByRole('button', { name: 'Columnas' }));

      await user.click(screen.getByRole('button', { name: 'Subir Name' }));

      await waitFor(() =>
        expect(
          screen.getAllByRole('columnheader').map(cell => cell.textContent),
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
      <EntityTable<Widget>
        entityConstructor={Widget}
        items={[unsaved]}
        {...pager}
      >
        <EntityTableRow<Widget>
          render={item => (
            <tr>
              <td>{`Row ${String(item.name)}`}</td>
            </tr>
          )}
        />
      </EntityTable>,
    );

    expect(screen.getByText('Row Draft')).toBeInTheDocument();
  });

  // Two tables over the same entity — a picker and a full listing, say — need
  // separate layouts, which is what the explicit key is for.
  it('scopes personalization to an explicit preferences key', async () => {
    const user = userEvent.setup();
    const written: string[] = [];
    const store: UiPreferencesState = {
      read: () => Effect.succeed(undefined),
      write: key => Effect.sync(() => void written.push(key)),
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

    await user.click(screen.getByRole('button', { name: 'Columnas' }));
    await user.click(screen.getByLabelText('Units in stock'));

    await waitFor(() =>
      expect(written).toEqual(['entity-table:widget-picker']),
    );
  });

  it('adds a computed column that the entity has no member for', () => {
    render(
      <EntityTable<Widget>
        entityConstructor={Widget}
        items={[makeWidget()]}
        {...pager}
      >
        <EntityColumn field="margin" render={() => 'computed'} />
      </EntityTable>,
    );

    expect(
      screen.getByRole('columnheader', { name: 'margin' }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('computed')).toHaveLength(2);
  });
});

describe('EntityTable defaults', () => {
  beforeEach(() => window.localStorage.clear());

  it('closes the sorting panel when its button is pressed again', async () => {
    const user = userEvent.setup();
    render(
      <EntityTable<Widget>
        entityConstructor={Widget}
        items={[makeWidget()]}
        {...pager}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Orden' }));
    expect(
      screen.getByRole('button', { name: 'Añadir orden' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Orden' }));

    expect(
      screen.queryByRole('button', { name: 'Añadir orden' }),
    ).not.toBeInTheDocument();
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
    const store: UiPreferencesState = {
      read: () => Effect.succeed(undefined),
      write: key => Effect.sync(() => void written.push(key)),
      remove: () => Effect.void,
    };
    render(
      <UiPreferencesProvider store={store}>
        <EntityTable<Unkeyed>
          entityConstructor={Unkeyed}
          items={[]}
          {...pager}
        />
      </UiPreferencesProvider>,
    );

    await user.click(screen.getByRole('button', { name: 'Columnas' }));
    await user.click(screen.getByRole('button', { name: 'Restablecer' }));

    await waitFor(() => expect(written).toEqual(['entity-table:Unkeyed']));
  });
});
