import { NEW_COMMAND_PAGE } from '@r10c/business-ts-authz';
import { EntifixQueryProvider } from '@r10c/entifix-react-integration';
import type { EntityMetadataSource } from '@r10c/entifix-ts-core';
import {
  accessor,
  type Entity,
  entity,
  type EntityId,
} from '@r10c/entifix-ts-core';
import { renderWithAdapters } from '@r10c/entifix-ts-testing-unit/react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { NavSection } from '../back-office/nav.js';
import { useTabsState } from '../workspace/tabs-state.js';
import { CommandPaletteHost } from './command-palette-host.js';
import type { PaletteCommand } from './palette-command.js';

/** A stand-in effect. An empty arrow body is a lint error; this is deliberate. */
const noop = async (): Promise<void> => undefined;

@entity({
  domain: 'authn',
  key: 'palette-subject',
  labelKey: 'entity:user-identity.label',
})
class PaletteSubject implements Entity {
  #id?: EntityId;
  @accessor({ type: 'id', label: 'ID' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }
}

const push = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => '/es/home',
  useRouter: () => ({ push }),
}));

const commands: PaletteCommand[] = [
  {
    key: 'new:product-specification',
    label: 'Nuevo producto',
    keywords: [],
    href: '/catalog/product/new',
    page: NEW_COMMAND_PAGE,
  },
];

const nav: NavSection[] = [
  {
    title: 'Catálogo',
    type: 'master',
    items: [{ label: 'Productos', href: '/catalog/product' }],
  },
];

const fetchMock = vi.fn();

const emptySearch = {
  ok: true,
  status: 200,
  json: async () => ({ term: '', groups: [], unavailable: [] }),
};

beforeEach(() => {
  push.mockReset();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(emptySearch);
  vi.stubGlobal('fetch', fetchMock);
  useTabsState.setState({ tabs: [], activeParam: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const mount = () =>
  renderWithAdapters(
    <EntifixQueryProvider>
      <CommandPaletteHost commands={commands} nav={nav} />
    </EntifixQueryProvider>,
  );

const open = async () => {
  await userEvent.click(screen.getByTestId('command-palette-trigger'));
  return screen.findByTestId('command-palette');
};

describe('CommandPaletteHost', () => {
  it('offers a visible trigger, because a shortcut may be swallowed', () => {
    mount();

    expect(screen.getByTestId('command-palette-trigger')).toHaveTextContent(
      'Buscar o ejecutar',
    );
    expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument();
  });

  it.each([
    ['⌘K', '{Meta>}k{/Meta}'],
    ['Ctrl+K', '{Control>}k{/Control}'],
    ['⌘⇧P', '{Meta>}{Shift>}p{/Shift}{/Meta}'],
  ])('opens on %s', async (_name, chord) => {
    mount();

    await userEvent.keyboard(chord);

    expect(await screen.findByTestId('command-palette')).toBeInTheDocument();
  });

  it('shows destinations and the create opener with no term typed', async () => {
    mount();
    await open();

    expect(
      await screen.findByRole('option', { name: /Nuevo…/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Productos/ })).toBeInTheDocument();
  });

  it('narrows to commands on ">" and asks no service for records', async () => {
    mount();
    await open();

    await userEvent.type(screen.getByRole('combobox'), '>nuevo');

    await waitFor(() =>
      expect(screen.queryByText('Navegación')).not.toBeInTheDocument(),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('narrows to records on "#"', async () => {
    mount();
    await open();

    await userEvent.type(screen.getByRole('combobox'), '#acme');

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByText('Comandos')).not.toBeInTheDocument();
  });

  it('descends into the create page and comes back', async () => {
    mount();
    await open();

    await userEvent.click(await screen.findByRole('option', { name: /Nuevo…/ }));

    expect(
      screen.getByPlaceholderText('¿Qué quieres crear?'),
    ).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Volver' }));
    expect(
      screen.getByPlaceholderText(
        'Busca un registro, una pantalla o un comando…',
      ),
    ).toBeInTheDocument();
  });

  it('spends no fan-out on a pushed page, which shows its own sources', async () => {
    mount();
    await open();
    await userEvent.click(await screen.findByRole('option', { name: /Nuevo…/ }));

    await userEvent.type(screen.getByRole('combobox'), 'acme');

    await waitFor(() =>
      expect(screen.getByPlaceholderText('¿Qué quieres crear?')).toHaveValue(
        'acme',
      ),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('navigates on a destination and closes', async () => {
    mount();
    await open();

    await userEvent.click(
      await screen.findByRole('option', { name: /Productos/ }),
    );

    expect(push).toHaveBeenCalledWith('/es/catalog/product');
    await waitFor(() =>
      expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument(),
    );
  });

  it('offers the count a source held back, in the catalog’s own plural', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        term: 'acme',
        groups: [
          {
            source: 'product-specification',
            entity: 'product-specification',
            labelKey: 'entity:product-specification.plural',
            items: [
              {
                id: 'p-1',
                label: 'Acme Lamp',
                entity: 'product-specification',
                href: '/catalog/product/p-1',
              },
            ],
            total: 4,
          },
        ],
        unavailable: [],
      }),
    });
    mount();
    await open();

    await userEvent.type(screen.getByRole('combobox'), 'acme');

    expect(await screen.findByText('3 más')).toBeInTheDocument();
  });

  it('starts each opening from an empty term at the root', async () => {
    mount();
    await open();
    await userEvent.type(screen.getByRole('combobox'), 'zzz');
    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument(),
    );

    await open();

    expect(screen.getByRole('combobox')).toHaveValue('');
  });

  describe('a verb that asks before it runs', () => {
    const signOut = {
      key: 'sign-out-others',
      binding: 'unbound' as const,
      placement: 'context-independent' as const,
      labelKey: 'entity:user-identity.useCases.signOutOthers',
      confirm: {
        tone: 'destructive' as const,
        messageKey: 'entity:user-identity.useCases.signOutOthersConfirm',
      },
    };

    const mountWithVerb = (run: () => Promise<void>) => {
      const entities = [
        {
          entityConstructor: PaletteSubject,
          metadataSource: {
            fetchMetadata: async () => ({
              actions: [],
              useCases: [signOut],
            }),
          } satisfies EntityMetadataSource,
          handlers: { 'sign-out-others': run },
        },
      ];
      return renderWithAdapters(
        <EntifixQueryProvider>
          <CommandPaletteHost
            commands={commands}
            nav={nav}
            useCaseEntities={entities}
          />
        </EntifixQueryProvider>,
      );
    };

    it('asks with the descriptor’s own message before running', async () => {
      const run = vi.fn(noop);
      mountWithVerb(run);
      await open();

      await userEvent.click(
        await screen.findByRole('option', { name: /Cerrar mis otras sesiones/ }),
      );

      // The list goes away with the question, so a second selection cannot land
      // against a dialog that is about the first one.
      expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument();
      expect(
        screen.getByText(/Se cerrarán todas tus sesiones/),
      ).toBeInTheDocument();
      expect(run).not.toHaveBeenCalled();
    });

    it('runs it once confirmed, and navigates nowhere', async () => {
      const run = vi.fn(noop);
      mountWithVerb(run);
      await open();
      await userEvent.click(
        await screen.findByRole('option', { name: /Cerrar mis otras sesiones/ }),
      );

      await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

      expect(run).toHaveBeenCalledTimes(1);
      expect(push).not.toHaveBeenCalled();
    });

    it('runs nothing when the question is declined', async () => {
      const run = vi.fn(noop);
      mountWithVerb(run);
      await open();
      await userEvent.click(
        await screen.findByRole('option', { name: /Cerrar mis otras sesiones/ }),
      );

      await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

      expect(run).not.toHaveBeenCalled();
      expect(
        screen.queryByText(/Se cerrarán todas tus sesiones/),
      ).not.toBeInTheDocument();
    });

    it('leaves a rejected command to its own handler to report', async () => {
      const run = vi.fn(async () => {
        throw new Error('nope');
      });
      mountWithVerb(run);
      await open();
      await userEvent.click(
        await screen.findByRole('option', { name: /Cerrar mis otras sesiones/ }),
      );

      await userEvent.click(screen.getByRole('button', { name: 'Confirmar' }));

      // Nothing here re-throws it: an unhandled rejection is what a bare `await`
      // would have produced, and the handler owns the only context in which the
      // failure means anything.
      await waitFor(() => expect(run).toHaveBeenCalled());
    });
  });
});
