'use client';

import { SCREEN_TYPE_LABEL_KEYS } from '@r10c/business-ts-authz';
import { useT, useTranslateKey } from '@r10c/entifix-react-controls';
import {
  type CommandOption,
  type CommandSource,
  matchesCommand,
} from '@r10c/entifix-ts-core';
import { useMemo } from 'react';

import type { NavSection } from '../back-office/nav';
import { useLocaleHref } from '../i18n';

/** The workspace deep link a nav item's `workspace` address resolves to. */
const workspaceHref = (workspace: string) =>
  `/workspace?tab=${encodeURIComponent(workspace)}`;

/**
 * Every destination this caller may reach, as one group.
 *
 * The nav is already the answer to "what may this person see": `visibleNav`
 * applies both of ADR 0037's ceilings server-side, and what reaches here is the
 * resolved, filtered tree the sidebar renders. So the palette holds no second
 * projection of navigation — the thing ADR 0037 deleted `GET /api/menu` for.
 *
 * A destination that can also be a workspace tab contributes a **second**
 * option rather than a modifier on the first. The palette runs on Enter and has
 * no place to hang "hold ⌥ to open as a tab", and a hidden modifier is exactly
 * the undiscoverable affordance the sidebar's own workspace link was fixed for.
 *
 * The section's screen type is the option's hint, so Definiciones and
 * Operaciones stay distinguishable in a flat list — the sidebar's top tier
 * (ADR 0033) surviving the flattening rather than being dropped by it.
 */
export function useNavSource(
  sections: readonly NavSection[],
  term: string,
): CommandSource {
  const t = useT('shell');
  const translateKey = useTranslateKey();
  const withLocale = useLocaleHref();

  return useMemo(() => {
    const options: CommandOption[] = [];

    for (const section of sections) {
      // Only the screen type. Falling back to the section title here read as
      // "Perfil · Cuenta · Cuenta" on the untyped account section, because the
      // title is already the sublabel — one fact, printed twice.
      const hint =
        section.type === undefined
          ? undefined
          : translateKey(SCREEN_TYPE_LABEL_KEYS[section.type]);

      for (const item of section.items) {
        options.push({
          id: `nav:${item.href}`,
          label: item.label,
          href: withLocale(item.href),
          ...(hint === undefined ? {} : { hint }),
          ...(section.title === undefined ? {} : { sublabel: section.title }),
        });

        if (item.workspace !== undefined) {
          options.push({
            id: `nav:workspace:${item.workspace}`,
            label: item.label,
            href: withLocale(workspaceHref(item.workspace)),
            hint: t('commandPalette.openInWorkspaceHint'),
            ...(section.title === undefined ? {} : { sublabel: section.title }),
          });
        }
      }
    }

    return {
      key: 'navigation',
      groups: [
        {
          key: 'navigation',
          label: t('commandPalette.groups.navigation'),
          options: options.filter(option => matchesCommand(term, option)),
          isLoading: false,
        },
      ],
    } satisfies CommandSource;
  }, [sections, term, t, translateKey, withLocale]);
}
