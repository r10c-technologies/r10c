import {
  accessor,
  emptySelection,
  type Entity,
  entity,
  type EntityId,
  type EntityMetadataDocument,
  type EntitySelection,
  type UseCaseDescriptor,
} from '@r10c/entifix-ts-core';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EntityTable } from './entity-table';

@entity({ key: 'gizmo' })
class Gizmo implements Entity {
  #id?: EntityId;
  #name?: string;

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
}

const gizmo = (id: string, name: string): Gizmo => {
  const one = new Gizmo();
  one.id = id;
  one.name = name;
  return one;
};

const ITEMS = [gizmo('1', 'Alpha'), gizmo('2', 'Beta'), gizmo('3', 'Gamma')];

/** An entity whose only member *is* the identifier — nothing else to name a row by. */
@entity({ key: 'token' })
class Token implements Entity {
  #id?: EntityId;

  @accessor({ type: 'id', label: 'ID' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }
}

const useCase = (
  key: string,
  binding: UseCaseDescriptor['binding'],
  placement: UseCaseDescriptor['placement'],
  tone?: 'destructive',
): UseCaseDescriptor => ({
  key,
  binding,
  placement,
  labelKey: `entity:gizmo.useCases.${key}`,
  ...(tone
    ? { confirm: { tone, messageKey: `entity:gizmo.${key}.confirm` } }
    : {}),
});

const metadata = (
  ...useCases: UseCaseDescriptor[]
): EntityMetadataDocument => ({
  actions: ['read', 'write', 'delete'],
  useCases,
});

const pager = {
  isLoading: false,
  totalItems: ITEMS.length,
  currentPage: 1,
  pageSize: 10,
  onPageChange: () => undefined,
};

/**
 * **Both pivots are always in the DOM** — the grid and the card list, with CSS
 * choosing between them (`PIVOT_CLASS`). jsdom has no breakpoints, so every
 * row's selection box exists twice here, and an unscoped `getByRole('checkbox')`
 * finds two of everything. Scoping to the `<table>` is the rule for this file,
 * and it is also why the row box carries an `aria-label` and never an `id`.
 */
const grid = () => within(screen.getByRole('table'));

/**
 * A selection held above the table, the way a real page holds it — the shift
 * range reads the *previous* value, so a test that never re-renders with the
 * new one is testing a table that can never accumulate.
 */
const renderControlled = (
  onSelectionChange: (next: EntitySelection<Gizmo>) => void,
) => {
  const user = userEvent.setup();
  const view = render(
    <EntityTable<Gizmo>
      entityConstructor={Gizmo}
      items={ITEMS}
      showControls={false}
      {...pager}
      selection={emptySelection<Gizmo>()}
      onSelectionChange={onSelectionChange}
    />,
  );
  const rerender = (selection: EntitySelection<Gizmo>) =>
    view.rerender(
      <EntityTable<Gizmo>
        entityConstructor={Gizmo}
        items={ITEMS}
        showControls={false}
        {...pager}
        selection={selection}
        onSelectionChange={onSelectionChange}
      />,
    );
  return { user, rerender };
};

const renderTable = (
  props: Partial<Parameters<typeof EntityTable<Gizmo>>[0]> = {},
) => {
  const user = userEvent.setup();
  render(
    <EntityTable<Gizmo>
      entityConstructor={Gizmo}
      items={ITEMS}
      showControls={false}
      {...pager}
      {...props}
    />,
  );
  return { user };
};

describe('EntityTable selection', () => {
  beforeEach(() => window.localStorage.clear());

  it('renders no selection column without a selection', () => {
    renderTable();

    expect(grid().queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('renders a box per row plus the header box', () => {
    renderTable({
      selection: emptySelection<Gizmo>(),
      onSelectionChange: () => undefined,
    });

    expect(grid().getAllByRole('checkbox')).toHaveLength(ITEMS.length + 1);
  });

  /**
   * The row names the *record*, not its position: "Seleccionar Alpha" tells the
   * user which row they are on, where "row 2" only repeats what they can see.
   */
  it('names a row box after the record', () => {
    renderTable({
      selection: emptySelection<Gizmo>(),
      onSelectionChange: () => undefined,
    });

    expect(
      grid().getByRole('checkbox', { name: 'Seleccionar Alpha' }),
    ).toBeInTheDocument();
  });

  /**
   * Measured against the seeded catalog, where `code` is the first non-id
   * column and is empty on every brand: skipping only the id sent the label
   * straight to the id and never reached `name`. A blank column names a row no
   * better than its position does.
   */
  it('skips a blank column and names the row by the next one that has a value', () => {
    const sparse = gizmo('7', 'Acme');
    // `name` holds a value; an earlier column would not.
    renderTable({
      items: [sparse],
      selection: emptySelection<Gizmo>(),
      onSelectionChange: () => undefined,
    });

    expect(
      grid().getByRole('checkbox', { name: 'Seleccionar Acme' }),
    ).toBeInTheDocument();
  });

  /**
   * A row whose columns are all empty still has to announce itself, so the
   * id is the last resort — unreadable, but never silent.
   */
  it('falls back to the id when the naming column is empty', () => {
    const unnamed = new Gizmo();
    unnamed.id = '9';

    renderTable({
      items: [unnamed],
      selection: emptySelection<Gizmo>(),
      onSelectionChange: () => undefined,
    });

    expect(
      grid().getByRole('checkbox', { name: 'Seleccionar 9' }),
    ).toBeInTheDocument();
  });

  it('names a row by its id when the entity has no other column', () => {
    const token = new Token();
    token.id = 'tok-1';

    render(
      <EntityTable<Token>
        entityConstructor={Token}
        items={[token]}
        showControls={false}
        {...pager}
        selection={emptySelection<Token>()}
        onSelectionChange={() => undefined}
      />,
    );

    expect(
      grid().getByRole('checkbox', { name: 'Seleccionar tok-1' }),
    ).toBeInTheDocument();
  });

  it('reports a toggled row to the caller', async () => {
    const onSelectionChange = vi.fn();
    const { user } = renderTable({
      selection: emptySelection<Gizmo>(),
      onSelectionChange,
    });

    await user.click(
      grid().getByRole('checkbox', { name: 'Seleccionar Beta' }),
    );

    const next = onSelectionChange.mock.calls[0]?.[0] as EntitySelection<Gizmo>;
    expect(next.mode).toBe('ids');
    expect(next.mode === 'ids' && [...next.ids]).toEqual(['2']);
  });

  it('checks the boxes the selection names', () => {
    renderTable({
      selection: { mode: 'ids', ids: new Set(['1', '3']) },
      onSelectionChange: () => undefined,
    });

    expect(
      grid().getByRole('checkbox', { name: 'Seleccionar Alpha' }),
    ).toBeChecked();
    expect(
      grid().getByRole('checkbox', { name: 'Seleccionar Beta' }),
    ).not.toBeChecked();
  });

  describe('shift-click', () => {
    /**
     * The range runs from the last box the user actually toggled to the one
     * they shift-clicked, in whichever direction — selecting three rows should
     * cost two clicks, not three.
     */
    it('extends the selection forwards from the last toggle', async () => {
      const onSelectionChange = vi.fn();
      let selection: EntitySelection<Gizmo> = emptySelection<Gizmo>();
      const { user, rerender } = renderControlled(next => {
        selection = next;
        onSelectionChange(next);
      });

      await user.click(
        grid().getByRole('checkbox', { name: 'Seleccionar Alpha' }),
      );
      rerender(selection);
      await user.keyboard('{Shift>}');
      await user.click(
        grid().getByRole('checkbox', { name: 'Seleccionar Gamma' }),
      );
      await user.keyboard('{/Shift}');

      const last = onSelectionChange.mock
        .lastCall?.[0] as EntitySelection<Gizmo>;
      expect(last.mode === 'ids' && [...last.ids].sort()).toEqual([
        '1',
        '2',
        '3',
      ]);
    });

    /**
     * A shift-click with nothing toggled before it has no range to extend, so
     * it acts on the one row — anything else would select an arbitrary span
     * from whichever row happened to be first.
     */
    it('selects only the clicked row when there is no anchor yet', async () => {
      const onSelectionChange = vi.fn();
      const { user } = renderControlled(onSelectionChange);

      await user.keyboard('{Shift>}');
      await user.click(
        grid().getByRole('checkbox', { name: 'Seleccionar Gamma' }),
      );
      await user.keyboard('{/Shift}');

      const last = onSelectionChange.mock
        .lastCall?.[0] as EntitySelection<Gizmo>;
      expect(last.mode === 'ids' && [...last.ids]).toEqual(['3']);
    });

    /** Backwards is the same range, and must not silently select nothing. */
    it('extends backwards just the same', async () => {
      const onSelectionChange = vi.fn();
      let selection: EntitySelection<Gizmo> = emptySelection<Gizmo>();
      const { user, rerender } = renderControlled(next => {
        selection = next;
        onSelectionChange(next);
      });

      await user.click(
        grid().getByRole('checkbox', { name: 'Seleccionar Gamma' }),
      );
      rerender(selection);
      await user.keyboard('{Shift>}');
      await user.click(
        grid().getByRole('checkbox', { name: 'Seleccionar Alpha' }),
      );
      await user.keyboard('{/Shift}');

      const last = onSelectionChange.mock
        .lastCall?.[0] as EntitySelection<Gizmo>;
      expect(last.mode === 'ids' && [...last.ids].sort()).toEqual([
        '1',
        '2',
        '3',
      ]);
    });
  });

  describe('the header box', () => {
    it('selects every row on the page', async () => {
      const onSelectionChange = vi.fn();
      const { user } = renderTable({
        selection: emptySelection<Gizmo>(),
        onSelectionChange,
      });

      await user.click(
        grid().getByRole('checkbox', {
          name: 'Seleccionar todo en esta página',
        }),
      );

      const next = onSelectionChange.mock
        .calls[0]?.[0] as EntitySelection<Gizmo>;
      expect(next.mode === 'ids' && [...next.ids].sort()).toEqual([
        '1',
        '2',
        '3',
      ]);
    });

    it('is checked when every row is selected', () => {
      renderTable({
        selection: { mode: 'ids', ids: new Set(['1', '2', '3']) },
        onSelectionChange: () => undefined,
      });

      expect(
        grid().getByRole('checkbox', {
          name: 'Seleccionar todo en esta página',
        }),
      ).toBeChecked();
    });

    /**
     * The third state, and the reason `Checkbox` needed a ref at all: without
     * it a partly-selected page reads as "nothing selected" while a bulk bar
     * sits underneath saying two rows are.
     */
    it('is indeterminate when only some rows are selected', () => {
      renderTable({
        selection: { mode: 'ids', ids: new Set(['1']) },
        onSelectionChange: () => undefined,
      });

      const header = grid().getByRole('checkbox', {
        name: 'Seleccionar todo en esta página',
      }) as HTMLInputElement;

      expect(header.indeterminate).toBe(true);
      expect(header).not.toBeChecked();
    });

    it('is disabled with no rows to select', () => {
      renderTable({
        items: [],
        selection: emptySelection<Gizmo>(),
        onSelectionChange: () => undefined,
      });

      expect(
        grid().getByRole('checkbox', {
          name: 'Seleccionar todo en esta página',
        }),
      ).toBeDisabled();
    });
  });

  /** The placeholder has to occupy the real geometry, selection column included. */
  it('draws a placeholder cell for the selection column while loading', () => {
    renderTable({
      items: [],
      isLoading: true,
      selection: emptySelection<Gizmo>(),
      onSelectionChange: () => undefined,
    });

    // One shimmer per visible column plus the selection cell.
    const firstRow = grid().getAllByRole('row')[1];
    expect(within(firstRow!).getAllByRole('cell')).toHaveLength(3);
  });

  /**
   * A picker is choosing one value for a form member. Offering a multi-select
   * there would hand a set to a field that holds a single reference, and both
   * controls would compete for the same row — a wiring mistake, so it costs the
   * render rather than silently preferring one.
   */
  it('refuses to be a picker and a multi-selection at once', () => {
    expect(() =>
      renderTable({
        onSelect: () => undefined,
        selection: emptySelection<Gizmo>(),
        onSelectionChange: () => undefined,
      }),
    ).toThrow(/picks one row/);
  });
});

describe('EntityTable bulk bar', () => {
  beforeEach(() => window.localStorage.clear());

  const retire = useCase(
    'retire',
    'collection',
    'context-dependent',
    'destructive',
  );

  it('stays hidden while nothing is selected', () => {
    renderTable({
      selection: emptySelection<Gizmo>(),
      onSelectionChange: () => undefined,
      metadata: metadata(retire),
    });

    expect(screen.queryByTestId('bulk-action-bar')).not.toBeInTheDocument();
  });

  it('appears with the count once rows are selected', () => {
    renderTable({
      selection: { mode: 'ids', ids: new Set(['1', '2']) },
      onSelectionChange: () => undefined,
      metadata: metadata(retire),
    });

    expect(screen.getByTestId('bulk-action-bar')).toHaveTextContent(
      '2 seleccionados',
    );
  });

  it('runs a collection verb over the selection', async () => {
    const onBulkUseCase = vi.fn();
    const { user } = renderTable({
      selection: { mode: 'ids', ids: new Set(['1']) },
      onSelectionChange: () => undefined,
      metadata: metadata(retire),
      onBulkUseCase,
    });

    await user.click(
      within(screen.getByTestId('bulk-action-bar')).getByRole('button', {
        name: 'gizmo.useCases.retire',
      }),
    );

    expect(onBulkUseCase).toHaveBeenCalledWith(
      'retire',
      expect.objectContaining({ mode: 'ids' }),
    );
  });

  /** A bulk verb with no `confirm` is an ordinary action, not a deletion. */
  it('renders a non-destructive bulk verb in the neutral tone', () => {
    renderTable({
      selection: { mode: 'ids', ids: new Set(['1']) },
      onSelectionChange: () => undefined,
      metadata: metadata(useCase('tag', 'collection', 'context-dependent')),
    });

    expect(
      within(screen.getByTestId('bulk-action-bar')).getByRole('button', {
        name: 'gizmo.useCases.tag',
      }),
    ).toBeInTheDocument();
  });

  /**
   * An entity-bound verb is one record's, and a `determining` one is a form
   * footer's. Neither belongs to a set, so neither reaches this bar.
   */
  it('shows only collection-bound, context-dependent verbs', () => {
    renderTable({
      selection: { mode: 'ids', ids: new Set(['1']) },
      onSelectionChange: () => undefined,
      metadata: metadata(
        retire,
        useCase('publish', 'entity', 'determining'),
        useCase('import', 'collection', 'context-independent'),
      ),
    });

    const bar = within(screen.getByTestId('bulk-action-bar'));
    expect(
      bar.getByRole('button', { name: 'gizmo.useCases.retire' }),
    ).toBeInTheDocument();
    expect(
      bar.queryByRole('button', { name: 'gizmo.useCases.publish' }),
    ).not.toBeInTheDocument();
    expect(
      bar.queryByRole('button', { name: 'gizmo.useCases.import' }),
    ).not.toBeInTheDocument();
  });

  describe('the two select-alls', () => {
    /**
     * The escalation is a **separate affordance carrying the count**, never a
     * widening of the header box: acting on 3 rows and acting on 3.200 are
     * different decisions and the second has to be taken deliberately.
     */
    it('offers the matching set only once the page is full and more rows exist', () => {
      renderTable({
        selection: { mode: 'ids', ids: new Set(['1', '2', '3']) },
        onSelectionChange: () => undefined,
        metadata: metadata(retire),
        totalItems: 3200,
      });

      expect(
        screen.getByRole('button', {
          name: 'Seleccionar las 3200 coincidencias',
        }),
      ).toBeInTheDocument();
    });

    it('does not offer it when the page is the whole result', () => {
      renderTable({
        selection: { mode: 'ids', ids: new Set(['1', '2', '3']) },
        onSelectionChange: () => undefined,
        metadata: metadata(retire),
      });

      expect(
        screen.queryByRole('button', { name: /coincidencia/ }),
      ).not.toBeInTheDocument();
    });

    it('switches to the matching mode, carrying the filter and not the ids', async () => {
      const onSelectionChange = vi.fn();
      const filtering = { operator: 'and' as const, values: [] };
      const { user } = renderTable({
        selection: { mode: 'ids', ids: new Set(['1', '2', '3']) },
        onSelectionChange,
        metadata: metadata(retire),
        totalItems: 3200,
        filtering,
      });

      await user.click(
        screen.getByRole('button', {
          name: 'Seleccionar las 3200 coincidencias',
        }),
      );

      expect(onSelectionChange).toHaveBeenCalledWith({
        mode: 'matching',
        filtering,
        total: 3200,
        excluded: new Set(),
      });
    });
  });

  it('clears back to an empty id set', async () => {
    const onSelectionChange = vi.fn();
    const { user } = renderTable({
      selection: { mode: 'matching', total: 3200, excluded: new Set() },
      onSelectionChange,
      metadata: metadata(retire),
    });

    await user.click(screen.getByRole('button', { name: 'Limpiar selección' }));

    expect(onSelectionChange).toHaveBeenCalledWith({
      mode: 'ids',
      ids: new Set(),
    });
  });
});

describe('EntityTable bulk result', () => {
  beforeEach(() => window.localStorage.clear());

  const outcomes = [
    { id: '1', ok: true },
    { id: '2', ok: false, code: 'forbidden' },
  ];

  /**
   * The requirement, not an edge case: a single notice lies either way — as a
   * failure it hides the row that was written, as a success it hides the one
   * that was not.
   */
  it('states both counts', () => {
    renderTable({
      bulkOutcomes: outcomes,
      onBulkDismiss: () => undefined,
    });

    const result = within(screen.getByTestId('bulk-result'));
    expect(result.getByText('1 registro actualizado')).toBeInTheDocument();
    expect(result.getByText('1 registro falló')).toBeInTheDocument();
  });

  /**
   * A bulk run over a "select all matching" set touches rows that were never
   * on this page, so a failure can name a row the table cannot see. The id is
   * the honest fallback — worse to read than a name, and far better than
   * omitting the row from the report.
   */
  it('falls back to the id for a row that is not on the page', () => {
    renderTable({
      bulkOutcomes: [{ id: '99', ok: false, code: 'forbidden' }],
      onBulkDismiss: () => undefined,
    });

    expect(screen.getByTestId('bulk-result')).toHaveTextContent('99');
  });

  /** A failure the service did not code still has to say *something*. */
  it('falls back to the unexpected code when none was given', () => {
    renderTable({
      bulkOutcomes: [{ id: '1', ok: false }],
      onBulkDismiss: () => undefined,
    });

    expect(screen.getByTestId('bulk-result')).toBeInTheDocument();
  });

  it('names each failed row and its reason', () => {
    renderTable({
      bulkOutcomes: outcomes,
      onBulkDismiss: () => undefined,
    });

    // The row's own label, not its id — the user selected "Beta", not "2".
    expect(screen.getByTestId('bulk-result')).toHaveTextContent('Beta');
  });

  it('retries the failures only', async () => {
    const onBulkRetry = vi.fn();
    const { user } = renderTable({
      bulkOutcomes: outcomes,
      onBulkDismiss: () => undefined,
      onBulkRetry,
    });

    await user.click(
      screen.getByRole('button', { name: 'Reintentar los fallidos' }),
    );

    expect(onBulkRetry).toHaveBeenCalledWith(['2']);
  });

  it('offers no retry when every row succeeded', () => {
    renderTable({
      bulkOutcomes: [{ id: '1', ok: true }],
      onBulkDismiss: () => undefined,
      onBulkRetry: () => undefined,
    });

    expect(
      screen.queryByRole('button', { name: 'Reintentar los fallidos' }),
    ).not.toBeInTheDocument();
  });
});

describe('EntityTable toolbar verbs', () => {
  beforeEach(() => window.localStorage.clear());

  const importAll = useCase('import', 'collection', 'context-independent');

  /**
   * A collection verb that needs no selection sits with `New`, not in the bulk
   * bar — the bar only exists while rows are ticked, and this is always
   * available.
   */
  it('renders a context-independent collection verb in the toolbar', () => {
    renderTable({ showControls: true, metadata: metadata(importAll) });

    expect(
      screen.getByRole('button', { name: 'gizmo.useCases.import' }),
    ).toBeInTheDocument();
  });

  /**
   * Its subject is the collection, so the payload is everything the current
   * filter matches — **not** an empty id set, which would say "no rows".
   */
  it('runs it over everything the filter matches', async () => {
    const onBulkUseCase = vi.fn();
    const filtering = { operator: 'and' as const, values: [] };
    const { user } = renderTable({
      showControls: true,
      metadata: metadata(importAll),
      onBulkUseCase,
      filtering,
      totalItems: 3200,
    });

    await user.click(
      screen.getByRole('button', { name: 'gizmo.useCases.import' }),
    );

    expect(onBulkUseCase).toHaveBeenCalledWith('import', {
      mode: 'matching',
      filtering,
      total: 3200,
      excluded: new Set(),
    });
  });

  it('renders a destructive toolbar verb as such', () => {
    renderTable({
      showControls: true,
      metadata: metadata(
        useCase('purge', 'collection', 'context-independent', 'destructive'),
      ),
    });

    expect(
      screen.getByRole('button', { name: 'gizmo.useCases.purge' }),
    ).toBeInTheDocument();
  });

  it('holds the toolbar’s shape while the metadata is in flight', () => {
    renderTable({ showControls: true, isMetadataLoading: true });

    expect(screen.getByTestId('loading-boundary')).toBeInTheDocument();
  });
});

describe('EntityTable row menu', () => {
  beforeEach(() => window.localStorage.clear());

  const archive = useCase(
    'archive',
    'entity',
    'context-dependent',
    'destructive',
  );

  /**
   * The cell ADR 0026 declared and no surface rendered: an entity-bound verb
   * that needs a row to act on.
   */
  it('renders context-dependent entity verbs per row', async () => {
    const onUseCase = vi.fn();
    const { user } = renderTable({
      metadata: metadata(archive),
      onUseCase,
    });

    await user.click(grid().getAllByRole('button', { name: 'Acciones' })[0]!);
    await user.click(
      screen.getByRole('menuitem', { name: 'gizmo.useCases.archive' }),
    );

    expect(onUseCase).toHaveBeenCalledWith('archive', ITEMS[0]);
  });

  /** A verb with no `confirm` reads as an ordinary entry, not a deletion. */
  it('renders a verb without a confirmation in the neutral tone', async () => {
    const { user } = renderTable({
      metadata: metadata(useCase('duplicate', 'entity', 'context-dependent')),
      onUseCase: () => undefined,
    });

    await user.click(grid().getAllByRole('button', { name: 'Acciones' })[0]!);

    expect(
      screen.getByRole('menuitem', { name: 'gizmo.useCases.duplicate' }),
    ).toBeInTheDocument();
  });

  it('keeps the open link beside the menu', () => {
    renderTable({
      metadata: metadata(archive),
      onUseCase: () => undefined,
      hrefFor: (id: EntityId) => `/gizmo/${String(id)}`,
    });

    expect(grid().getAllByRole('link', { name: 'Abrir' })).toHaveLength(
      ITEMS.length,
    );
  });
});
