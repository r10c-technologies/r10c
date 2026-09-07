import type {
  CommandGroup,
  CommandOption,
  CommandPage,
} from '@r10c/entifix-ts-core';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CommandPalette, type CommandPaletteProps } from './command-palette.js';

const labels = {
  title: 'Buscar o ejecutar',
  empty: 'Sin resultados',
  loading: 'Buscando…',
  more: (remaining: number) => `${remaining} más`,
  back: 'Volver',
};

const group = (overrides: Partial<CommandGroup> = {}): CommandGroup => ({
  key: 'commands',
  label: 'Comandos',
  options: [],
  isLoading: false,
  ...overrides,
});

const option = (overrides: Partial<CommandOption> = {}): CommandOption => ({
  id: 'new-product',
  label: 'Nuevo producto',
  href: '/catalog/product/new',
  ...overrides,
});

const page = (overrides: Partial<CommandPage> = {}): CommandPage => ({
  id: 'root',
  placeholder: 'Escribe para buscar…',
  sources: [],
  ...overrides,
});

const renderPalette = (overrides: Partial<CommandPaletteProps> = {}) => {
  const props: CommandPaletteProps = {
    open: true,
    onClose: vi.fn(),
    pages: [page()],
    stack: [],
    onStackChange: vi.fn(),
    term: '',
    onTermChange: vi.fn(),
    onSelect: vi.fn(),
    labels,
    ...overrides,
  };
  return { ...render(<CommandPalette {...props} />), props };
};

describe('CommandPalette', () => {
  it('renders nothing while closed', () => {
    renderPalette({ open: false });

    expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument();
  });

  it('names the dialog and its input, so neither is announced as untitled', () => {
    renderPalette();

    expect(
      screen.getByRole('dialog', { name: labels.title }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('combobox', { name: labels.title }),
    ).toBeInTheDocument();
  });

  it('puts focus in the input, not on the back control', async () => {
    renderPalette({
      pages: [
        page({ id: 'root', placeholder: 'Escribe para buscar…', sources: [] }),
        page({ id: 'new', title: 'Nuevo', placeholder: '¿Qué crear?', sources: [] }),
      ],
      stack: ['new'],
    });

    await waitFor(() =>
      expect(screen.getByRole('combobox')).toHaveFocus(),
    );
  });

  it('renders groups in the order the sources declared them', () => {
    renderPalette({
      pages: [
        page({
          sources: [
            {
              key: 'commands',
              groups: [group({ options: [option()] })],
            },
            {
              key: 'records',
              groups: [
                group({
                  key: 'product',
                  label: 'Productos',
                  options: [
                    option({ id: 'p-1', label: 'Acme', href: '/x/p-1' }),
                  ],
                }),
              ],
            },
          ],
        }),
      ],
    });

    const headings = screen
      .getAllByRole('presentation')
      .map(node => node.textContent);
    expect(headings.indexOf('Comandos')).toBeLessThan(
      headings.indexOf('Productos'),
    );
  });

  it('renders a sublabel and a hint beside the label', () => {
    renderPalette({
      pages: [
        page({
          sources: [
            {
              key: 'records',
              groups: [
                group({
                  options: [option({ sublabel: 'ACME-1', hint: 'Productos' })],
                }),
              ],
            },
          ],
        }),
      ],
    });

    expect(screen.getByText('ACME-1')).toBeInTheDocument();
    expect(screen.getByText('Productos')).toBeInTheDocument();
  });

  it('announces the wait while a group is still answering', () => {
    renderPalette({
      pages: [
        page({
          sources: [{ key: 'records', groups: [group({ isLoading: true })] }],
        }),
      ],
    });

    expect(screen.getByText(labels.loading)).toBeInTheDocument();
    expect(screen.queryByText(labels.empty)).not.toBeInTheDocument();
  });

  it('offers the count a group did not show', () => {
    renderPalette({
      pages: [
        page({
          sources: [
            {
              key: 'records',
              groups: [group({ options: [option()], total: 9 })],
            },
          ],
        }),
      ],
    });

    expect(screen.getByText('8 más')).toBeInTheDocument();
  });

  it('says nothing about a total the source never counted', () => {
    renderPalette({
      pages: [
        page({
          sources: [{ key: 'records', groups: [group({ options: [option()] })] }],
        }),
      ],
    });

    expect(screen.queryByText(/más/)).not.toBeInTheDocument();
  });

  it('names a degraded source instead of dropping its group', () => {
    renderPalette({
      pages: [
        page({
          sources: [
            {
              key: 'records',
              groups: [
                group({
                  key: 'product',
                  label: 'Productos',
                  unavailable: {
                    message: 'No tienes una organización activa',
                    severity: 'scope',
                  },
                }),
              ],
            },
          ],
        }),
      ],
    });

    expect(screen.getByTestId('command-group-product')).toBeInTheDocument();
    expect(
      screen.getByText('No tienes una organización activa'),
    ).toBeInTheDocument();
    // The ordinary case must not read as a failure, or the warning that means
    // something stops being read at all.
    expect(screen.getByTestId('command-unavailable-product')).not.toHaveClass(
      'text-danger',
    );
  });

  it('paints an unreachable source as a warning', () => {
    renderPalette({
      pages: [
        page({
          sources: [
            {
              key: 'records',
              groups: [
                group({
                  key: 'product',
                  unavailable: { message: 'Sin respuesta', severity: 'reachability' },
                }),
              ],
            },
          ],
        }),
      ],
    });

    expect(screen.getByTestId('command-unavailable-product')).toHaveClass(
      'text-danger',
    );
  });

  it('shows the empty state only when every group is genuinely empty', () => {
    renderPalette({
      pages: [
        page({ sources: [{ key: 'commands', groups: [group()] }] }),
      ],
    });

    expect(screen.getByText(labels.empty)).toBeInTheDocument();
    expect(screen.queryByTestId('command-group-commands')).not.toBeInTheDocument();
  });

  it('hands a chosen option to the caller rather than acting on it', async () => {
    const onSelect = vi.fn();
    renderPalette({
      onSelect,
      pages: [
        page({
          sources: [{ key: 'commands', groups: [group({ options: [option()] })] }],
        }),
      ],
    });

    await userEvent.click(screen.getByRole('option', { name: /Nuevo producto/ }));

    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'new-product' }),
    );
  });

  describe('the page stack', () => {
    const pages = [
      page({
        sources: [
          {
            key: 'commands',
            groups: [
              group({
                options: [
                  option({ id: 'new', label: 'Nuevo…', href: undefined, push: 'new' }),
                ],
              }),
            ],
          },
        ],
      }),
      page({
        id: 'new',
        title: 'Nuevo',
        placeholder: '¿Qué quieres crear?',
        sources: [
          {
            key: 'creates',
            groups: [group({ key: 'creates', options: [option()] })],
          },
        ],
      }),
    ];

    it('pushes rather than selecting, and clears the term', async () => {
      const onStackChange = vi.fn();
      const onTermChange = vi.fn();
      const onSelect = vi.fn();
      renderPalette({ pages, onStackChange, onTermChange, onSelect, term: 'nue' });

      await userEvent.click(screen.getByRole('option', { name: /Nuevo…/ }));

      expect(onStackChange).toHaveBeenCalledWith(['new']);
      expect(onTermChange).toHaveBeenCalledWith('');
      expect(onSelect).not.toHaveBeenCalled();
    });

    it('renders the pushed page, its placeholder and a way back', () => {
      renderPalette({ pages, stack: ['new'] });

      expect(
        screen.getByPlaceholderText('¿Qué quieres crear?'),
      ).toBeInTheDocument();
      expect(screen.getByRole('button', { name: labels.back })).toBeInTheDocument();
    });

    it('pops on the back control', async () => {
      const onStackChange = vi.fn();
      renderPalette({ pages, stack: ['new'], onStackChange });

      await userEvent.click(screen.getByRole('button', { name: labels.back }));

      expect(onStackChange).toHaveBeenCalledWith([]);
    });

    it('pops on Backspace once the term is empty', async () => {
      const onStackChange = vi.fn();
      renderPalette({ pages, stack: ['new'], term: '', onStackChange });

      await userEvent.type(screen.getByRole('combobox'), '{Backspace}');

      expect(onStackChange).toHaveBeenCalledWith([]);
    });

    it('leaves Backspace alone while there is a term to delete', async () => {
      const onStackChange = vi.fn();
      renderPalette({ pages, stack: ['new'], term: 'ab', onStackChange });

      await userEvent.type(screen.getByRole('combobox'), '{Backspace}');

      expect(onStackChange).not.toHaveBeenCalled();
    });

    it('leaves Backspace alone at the root, where there is nothing to pop', async () => {
      const onStackChange = vi.fn();
      const onClose = vi.fn();
      renderPalette({ pages, stack: [], term: '', onStackChange, onClose });

      await userEvent.type(screen.getByRole('combobox'), '{Backspace}');

      expect(onStackChange).not.toHaveBeenCalled();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('falls back to the root when the stack names a page that is gone', () => {
      renderPalette({ pages, stack: ['vanished'] });

      expect(
        screen.getByPlaceholderText('Escribe para buscar…'),
      ).toBeInTheDocument();
    });

    it('closes on Escape even once a term has been typed', async () => {
      // `Combobox` swallows Escape as "close the suggestions" once there is a
      // term, and a `static` list has none to close — so without the input's own
      // handler the palette stays open for exactly the person who typed.
      const onClose = vi.fn();
      renderPalette({ pages, term: 'zzz', onClose });

      await userEvent.type(screen.getByRole('combobox'), '{Escape}');

      expect(onClose).toHaveBeenCalled();
    });

    it('closes on Escape at the root and pops one level below it', async () => {
      const onClose = vi.fn();
      const onStackChange = vi.fn();
      const { unmount } = renderPalette({ pages, onClose, onStackChange });

      await userEvent.keyboard('{Escape}');
      expect(onClose).toHaveBeenCalled();
      unmount();

      renderPalette({ pages, stack: ['new'], onClose, onStackChange });
      await userEvent.keyboard('{Escape}');
      expect(onStackChange).toHaveBeenCalledWith([]);
    });
  });

  it('refuses an option that would look selectable and do nothing', () => {
    expect(() =>
      renderPalette({
        pages: [
          page({
            sources: [
              {
                key: 'commands',
                groups: [
                  group({ options: [option({ href: undefined })] }),
                ],
              },
            ],
          }),
        ],
      }),
    ).toThrow(/declares 0 effects/);
  });
});
