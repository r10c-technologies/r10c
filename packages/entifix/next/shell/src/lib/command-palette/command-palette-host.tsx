'use client';

import { NEW_COMMAND_PAGE } from '@r10c/business-ts-authz';
import {
  Button,
  CommandPalette,
  type CommandPaletteLabels,
  ConfirmDialog,
  useHotkey,
  useT,
} from '@r10c/entifix-react-controls';
import {
  type CommandOption,
  type CommandPage,
  type CommandSource,
  parseCommandTerm,
  ROOT_COMMAND_PAGE,
} from '@r10c/entifix-ts-core';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { NavSection } from '../back-office/nav';
import type { PaletteCommand } from './palette-command';
import { useCommandRecency } from './use-command-recency';
import { useCommandSource } from './use-command-source';
import { useNavSource } from './use-nav-source';
import { useRecordsSource } from './use-records-source';
import { useTabsSource } from './use-tabs-source';
import {
  type UseCaseCommandEntity,
  useUseCaseSources,
} from './use-use-cases-source';

/**
 * ⌘K **and** ⌘⇧P, and neither is load-bearing.
 *
 * #112 argued for ⌘⇧P alone because Chrome and Firefox claim ⌘K for address-bar
 * search. That is half the picture: ⌘⇧P / Ctrl+Shift+P is Firefox's private
 * window, so **both** candidates collide somewhere. ⌘K is also what Linear,
 * GitHub, Slack and Vercel trained people on, so leaving it unbound costs a
 * reflex.
 *
 * Binding both, plus a permanently visible trigger, is what makes the collision
 * a non-issue: whichever a given browser swallows, two other ways in remain.
 */
const HOTKEYS = [
  { key: 'k', mod: true },
  { key: 'p', mod: true, shift: true },
] as const;

export interface CommandPaletteHostProps {
  /**
   * Deterministic commands, already permission-filtered and translated by the
   * server layout that has the principal.
   */
  readonly commands: readonly PaletteCommand[];
  /** The same resolved nav tree the sidebar renders. */
  readonly nav: readonly NavSection[];
  /**
   * Entities whose served `$metadata` contributes `unbound` verbs, with the
   * handler for each.
   *
   * ⚠️ Must be a **module-scope constant**: the sources are produced by a hook
   * per entity, so a fresh array each render changes the hook count. See
   * `useUseCaseSources`.
   */
  readonly useCaseEntities?: readonly UseCaseCommandEntity[];
}

/** A verb waiting on its confirmation. */
interface PendingConfirm {
  readonly option: CommandOption;
  readonly message: string;
  readonly tone: 'destructive' | 'neutral';
}

const NO_ENTITIES: readonly UseCaseCommandEntity[] = [];

/**
 * The back office's command palette: its trigger, its shortcuts, and everything
 * it can reach.
 *
 * This is the composition point. The control in `entifix-react-controls` is
 * presentational and the sources are hooks; what lives here is the small set of
 * decisions neither can make — which sources a typed prefix asks for, what
 * selecting an option does, and when to ask first.
 *
 * **The grammar is for entry, the stack is for depth.** `>` narrows to commands
 * and actions, `#` to records, and anything else searches everything. Descending
 * into "Nuevo…" is a pushed page rather than a third prefix, because a prefix has
 * to be remembered and a list can be read.
 *
 * The whole thing is mounted in the chrome, so it is reachable from every route
 * the back office serves — including `/workspace`, which is where the open-tabs
 * group has anything in it.
 */
export function CommandPaletteHost({
  commands,
  nav,
  useCaseEntities = NO_ENTITIES,
}: CommandPaletteHostProps) {
  const t = useT('shell');
  const router = useRouter();
  const recency = useCommandRecency();

  const [open, setOpen] = useState(false);
  const [rawTerm, setRawTerm] = useState('');
  const [stack, setStack] = useState<readonly string[]>([]);
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const { scope, term } = parseCommandTerm(rawTerm);

  // Every source runs on every render — the hook count may not depend on the
  // page or the prefix. What those decide is which sources are *shown*, which is
  // why each returns a whole `CommandSource` instead of being called
  // conditionally. So the root's commands and the create page's are two sources
  // rather than one that reads the stack.
  const commandSource = useCommandSource(commands, term, undefined);
  const createSource = useCommandSource(commands, term, NEW_COMMAND_PAGE);
  const useCaseSources = useUseCaseSources(useCaseEntities, term);
  const navSource = useNavSource(nav, term);
  const tabsSource = useTabsSource(term);
  const recordsSource = useRecordsSource(
    term,
    // A record fan-out is four authenticated requests per keystroke, so it is
    // spent only where its answer is rendered: not while closed, not while the
    // prefix says commands, and not on a pushed page, which shows its own
    // sources and nothing else.
    open && scope !== 'commands' && stack.length === 0,
  );

  const rank = (source: CommandSource): CommandSource => ({
    ...source,
    groups: source.groups.map(recency.rank),
  });

  const rootSources: CommandSource[] =
    scope === 'records'
      ? [recordsSource]
      : scope === 'commands'
        ? [commandSource, ...useCaseSources]
        : [
            commandSource,
            ...useCaseSources,
            navSource,
            tabsSource,
            recordsSource,
          ];

  const pages: CommandPage[] = [
    {
      id: ROOT_COMMAND_PAGE,
      placeholder: t('commandPalette.placeholder'),
      sources: rootSources.map(rank),
    },
    {
      id: NEW_COMMAND_PAGE,
      title: t('commandPalette.newTitle'),
      placeholder: t('commandPalette.newPlaceholder'),
      sources: [rank(createSource)],
    },
  ];

  const labels: CommandPaletteLabels = {
    title: t('commandPalette.title'),
    empty: t('commandPalette.empty'),
    loading: t('commandPalette.loading'),
    more: remaining => t('commandPalette.more', { count: remaining }),
    back: t('commandPalette.back'),
  };

  const close = () => {
    setOpen(false);
    setPending(null);
  };

  // Opening resets the term and the stack in the same handler that opens it,
  // rather than from an effect keyed on `open` — a fresh palette is a fact about
  // this event, not something to react to afterwards.
  const openPalette = () => {
    setRawTerm('');
    setStack([]);
    setPending(null);
    setOpen(true);
  };

  useHotkey(HOTKEYS, openPalette);

  const perform = (option: CommandOption) => {
    recency.remember(option.id);
    close();
    if (option.href !== undefined) {
      router.push(option.href);
      return;
    }
    // A rejected command is the handler's to report — it owns the request and
    // therefore the only context in which the failure means anything. Letting it
    // reject unhandled here would surface as an unhandled rejection instead.
    void option.run?.();
  };

  const select = (option: CommandOption) => {
    if (option.confirm !== undefined) {
      // The palette closes and the question stands alone. Leaving the list
      // behind a modal invites a second selection against a dialog that is
      // already about the first one.
      setOpen(false);
      setPending({
        option,
        message: option.confirm.message,
        tone: option.confirm.tone,
      });
      return;
    }
    perform(option);
  };

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={openPalette}
        data-testid="command-palette-trigger"
      >
        {t('commandPalette.open')}
      </Button>

      <CommandPalette
        open={open}
        onClose={close}
        pages={pages}
        stack={stack}
        onStackChange={setStack}
        term={rawTerm}
        onTermChange={setRawTerm}
        onSelect={select}
        labels={labels}
      />

      {pending !== null && (
        <ConfirmDialog
          open
          title={pending.option.label}
          message={pending.message}
          tone={pending.tone}
          onConfirm={() => {
            const option = pending.option;
            setPending(null);
            perform(option);
          }}
          onCancel={() => setPending(null)}
        />
      )}
    </>
  );
}
