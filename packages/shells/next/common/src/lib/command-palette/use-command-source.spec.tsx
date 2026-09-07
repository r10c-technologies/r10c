import { NEW_COMMAND_PAGE } from '@r10c/business-ts-authz';
import type { CommandSource } from '@r10c/entifix-ts-core';
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { PaletteCommand } from './palette-command.js';
import { useCommandSource } from './use-command-source.js';

vi.mock('next/navigation', () => ({ usePathname: () => '/es/home' }));

const commands: PaletteCommand[] = [
  {
    key: 'new:product-specification',
    label: 'Nuevo producto',
    keywords: ['new', 'create'],
    href: '/catalog/product/new',
    page: NEW_COMMAND_PAGE,
  },
  {
    key: 'new:user-identity',
    label: 'Nuevo usuario',
    keywords: [],
    href: '/users/new',
    page: NEW_COMMAND_PAGE,
  },
  { key: 'root:thing', label: 'Algo suelto', keywords: [], href: '/thing' },
];

const options = (source: CommandSource) => source.groups[0].options;
const run = (term: string, page?: string) =>
  renderHook(() => useCommandSource(commands, term, page)).result.current;

describe('useCommandSource', () => {
  it('shows only root-page commands at the root, plus the entry that descends', () => {
    expect(options(run('')).map(o => o.id)).toEqual([
      'palette:new',
      'root:thing',
    ]);
  });

  it('descends rather than navigating — the opener declares a push', () => {
    const opener = options(run(''))[0];

    expect(opener.push).toBe(NEW_COMMAND_PAGE);
    expect(opener.href).toBeUndefined();
  });

  it('shows a page’s own commands once it is open, and not the opener', () => {
    expect(options(run('', NEW_COMMAND_PAGE)).map(o => o.id)).toEqual([
      'new:product-specification',
      'new:user-identity',
    ]);
  });

  it('synthesizes no opener when no shell contributed a create command', () => {
    const { result } = renderHook(() =>
      useCommandSource([commands[2]], '', undefined),
    );

    expect(options(result.current).map(o => o.id)).toEqual(['root:thing']);
  });

  it('filters here rather than leaving it to the palette', () => {
    expect(options(run('usua', NEW_COMMAND_PAGE)).map(o => o.id)).toEqual([
      'new:user-identity',
    ]);
  });

  it('matches a command through its keywords', () => {
    expect(options(run('create', NEW_COMMAND_PAGE)).map(o => o.id)).toEqual([
      'new:product-specification',
    ]);
  });

  it('prefixes the locale, because a command navigates', () => {
    expect(options(run('', NEW_COMMAND_PAGE))[0].href).toBe(
      '/es/catalog/product/new',
    );
  });

  it('titles the group from the shell catalog', () => {
    expect(run('').groups[0].label).toBe('Comandos');
  });
});
