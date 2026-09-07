'use client';

import { NEW_COMMAND_PAGE } from '@r10c/business-ts-authz';
import { useT } from '@r10c/entifix-react-controls';
import {
  type CommandOption,
  type CommandSource,
  matchesCommand,
} from '@r10c/entifix-ts-core';
import { useMemo } from 'react';

import { useLocaleHref } from '../i18n';
import type { PaletteCommand } from './palette-command';

/**
 * The deterministic commands — "Nuevo producto", "Nuevo usuario" — as one group.
 *
 * **This hook filters; the palette does not.** Every source in the palette
 * arrives pre-filtered, because the record source is filtered by the service
 * that answered it and a component that filtered again would have to know which
 * groups were already narrowed.
 *
 * Commands declared on a sub-page do not appear at the root. What appears there
 * instead is one entry that descends into the page, which is what makes the
 * palette's first screen a short list of *kinds* of thing rather than one row
 * per creatable entity competing with the destinations beside them.
 */
export function useCommandSource(
  commands: readonly PaletteCommand[],
  term: string,
  page: string | undefined,
): CommandSource {
  const t = useT('shell');
  const withLocale = useLocaleHref();

  return useMemo(() => {
    const onThisPage = commands.filter(
      command => (command.page ?? undefined) === page,
    );

    const options: CommandOption[] = onThisPage.map(command => ({
      id: command.key,
      label: command.label,
      keywords: command.keywords,
      href: withLocale(command.href),
    }));

    // The root gains the entry that opens the create page — synthesized rather
    // than declared, because no shell can know whether *another* shell also
    // contributed a create command, and two shells each declaring the opener
    // would render it twice.
    if (page === undefined && commands.some(c => c.page === NEW_COMMAND_PAGE)) {
      options.unshift({
        id: 'palette:new',
        label: t('commandPalette.newLabel'),
        keywords: ['new', 'create', 'nuevo', 'crear'],
        push: NEW_COMMAND_PAGE,
      });
    }

    return {
      key: 'commands',
      groups: [
        {
          key: 'commands',
          label: t('commandPalette.groups.commands'),
          options: options.filter(option => matchesCommand(term, option)),
          isLoading: false,
        },
      ],
    } satisfies CommandSource;
  }, [commands, page, term, t, withLocale]);
}
