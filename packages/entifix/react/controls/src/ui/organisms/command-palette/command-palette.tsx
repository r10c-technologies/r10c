'use client';

import {
  Combobox,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
  Dialog,
  DialogPanel,
  DialogTitle,
} from '@headlessui/react';
import {
  commandEffectOf,
  type CommandGroup,
  type CommandOption,
  type CommandPage,
} from '@r10c/entifix-ts-core';
import type { KeyboardEvent } from 'react';

import { SkeletonText } from '../../atoms/skeleton';
import { cn } from '../../utils/cn';

/** Every string the palette renders. Resolved — this control does not translate. */
export interface CommandPaletteLabels {
  /** Names the dialog. A dialog with no accessible name is announced as "dialog". */
  readonly title: string;
  /** Nothing matched, and every source said so. */
  readonly empty: string;
  /** Announced while a group is still answering. */
  readonly loading: string;
  /** "N más" — a function, so the plural rule stays in the catalog. */
  readonly more: (remaining: number) => string;
  /** Leaves a pushed page. Also the chip's accessible name. */
  readonly back: string;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  /** Every page this palette can show. The root is the first. */
  pages: readonly CommandPage[];
  /**
   * The pushed page ids, outermost first — empty means the root.
   *
   * Controlled, so the host can empty it in the same handler that opens the
   * palette. An internal stack would have to be reset from an effect keyed on
   * `open`, which is setting state in a passive effect for something that is a
   * fact about the event that opened it.
   */
  stack: readonly string[];
  onStackChange: (stack: readonly string[]) => void;
  term: string;
  onTermChange: (term: string) => void;
  /**
   * An option was chosen. The host runs it — this control has no router and
   * cannot navigate, which is the `hrefFor` rule.
   */
  onSelect: (option: CommandOption) => void;
  labels: CommandPaletteLabels;
}

const groupIsEmpty = (group: CommandGroup): boolean =>
  group.options.length === 0 &&
  !group.isLoading &&
  group.unavailable === undefined;

function GroupHeading({ label }: { label: string }) {
  return (
    // `presentation`, not a heading: everything inside a `listbox` that is not
    // an `option` must be presentational, or assistive tech counts the heading
    // as a selectable row and the option count it announces is wrong.
    <div
      role="presentation"
      className="px-2xs pt-2xs pb-3xs text-step-xs font-semibold tracking-wide text-content-muted uppercase"
    >
      {label}
    </div>
  );
}

function CommandRow({ option }: { option: CommandOption }) {
  return (
    <ComboboxOption
      value={option}
      className={cn(
        'flex cursor-pointer items-baseline gap-2xs rounded-md px-2xs py-3xs',
        'text-step-sm text-content',
        'data-focus:bg-surface',
      )}
    >
      <span className="truncate">{option.label}</span>
      {option.sublabel !== undefined && (
        <span className="truncate text-step-xs text-content-muted">
          {option.sublabel}
        </span>
      )}
      {option.hint !== undefined && (
        <span className="ml-auto shrink-0 text-step-xs text-content-muted">
          {option.hint}
        </span>
      )}
    </ComboboxOption>
  );
}

function Group({
  group,
  labels,
}: {
  group: CommandGroup;
  labels: CommandPaletteLabels;
}) {
  const remaining =
    group.total === undefined ? 0 : group.total - group.options.length;

  return (
    <div data-testid={`command-group-${group.key}`}>
      <GroupHeading label={group.label} />

      {group.isLoading && (
        <div role="presentation" className="px-2xs py-3xs">
          {/* The skeleton is `aria-hidden`, so the wait needs its own text or a
              screen reader hears a group that simply has no rows. */}
          <span className="sr-only">{labels.loading}</span>
          <SkeletonText lines={2} />
        </div>
      )}

      {group.options.map(option => (
        <CommandRow key={option.id} option={option} />
      ))}

      {remaining > 0 && (
        <div
          role="presentation"
          className="px-2xs py-3xs text-step-xs text-content-muted"
        >
          {labels.more(remaining)}
        </div>
      )}

      {/*
        A degraded source is NAMED, never a missing group: an absent group reads
        as "nothing matched", which nobody can honestly claim about a source they
        could not reach. The two severities look different on purpose — `scope`
        is the ordinary state for an operator with no organization, and painting
        that as a warning on every keystroke teaches people to ignore the one
        that means something is broken.
      */}
      {group.unavailable !== undefined && (
        <div
          role="presentation"
          data-testid={`command-unavailable-${group.key}`}
          className={cn(
            'px-2xs py-3xs text-step-xs',
            group.unavailable.severity === 'reachability'
              ? 'text-danger'
              : 'text-content-muted',
          )}
        >
          {group.unavailable.message}
        </div>
      )}
    </div>
  );
}

/**
 * A floating command bar: search destinations, records and commands, and run
 * them from the keyboard.
 *
 * Presentational, and strictly so. It holds no index, performs no fetch and
 * knows no router — every group arrives already filtered, already authorized and
 * already translated, from hooks in the shell layer that meet this component at
 * the framework-free `CommandSource` port in core. That is the same arrangement
 * `EntityLinkSource` uses, and it exists because `entifix-react-controls` may
 * not import `entifix-react-integration`.
 *
 * **The sources filter, not this component.** A record group is filtered by the
 * service that answered it; a command group is filtered by the hook that built
 * it. Filtering again here would mean the palette had to know which groups were
 * pre-filtered, and a group that answered a *different* term would be silently
 * emptied rather than shown as stale.
 *
 * Depth is a **stack of pages**: selecting an option carrying `push` makes the
 * palette become that page. `Escape` pops one level and closes at the root;
 * `Backspace` on an empty term pops too, which is the gesture Raycast trained
 * people on and costs nothing when there is nothing to pop.
 *
 * Built on Headless UI's `Dialog` + `Combobox`, so the focus trap, focus
 * restoration, `role="combobox"`, `aria-expanded`, `aria-activedescendant` and
 * the arrow-key contract are the library's rather than seven hand-written
 * behaviours that each have to be right.
 */
export function CommandPalette({
  open,
  onClose,
  pages,
  stack,
  onStackChange,
  term,
  onTermChange,
  onSelect,
  labels,
}: CommandPaletteProps) {
  const activeId = stack[stack.length - 1];
  const page =
    (activeId === undefined
      ? pages[0]
      : pages.find(candidate => candidate.id === activeId)) ?? pages[0];

  const groups = page.sources.flatMap(source => source.groups);
  // Runs on every render of the palette, not on the click: an option with no
  // effect — or with two — is a line that looks selectable and misbehaves, and
  // the check that only fires when someone already selected it is the check
  // that fires after the bug is reported.
  groups.forEach(group => group.options.forEach(commandEffectOf));

  const isEmpty = groups.every(groupIsEmpty);

  const pop = () => {
    if (stack.length === 0) {
      onClose();
      return;
    }
    onStackChange(stack.slice(0, -1));
    onTermChange('');
  };

  const handleSelect = (option: CommandOption | null) => {
    // Headless UI types `onChange` as nullable — it reports `null` when a search
    // is abandoned rather than chosen, and acting on that would run whatever
    // happened to be highlighted.
    //
    // ⚠️ Unreachable *here*, and ignored for coverage rather than contorted
    // around: this combobox is driven entirely from the outside (`value` is the
    // caller's `term`, there is no `displayValue`) and Escape is handled on the
    // input above, so the library never produces the null it admits. The guard
    // stays because the type is the library's contract, not ours to assume away.
    /* v8 ignore next 2 */
    if (option === null) return;
    if (option.push !== undefined) {
      onStackChange([...stack, option.push]);
      onTermChange('');
      return;
    }
    onSelect(option);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // ⚠️ Escape is handled here rather than left to the `Dialog`, because
    // `Combobox` consumes it first once a term has been typed — it treats the
    // key as "close the suggestion list", which for a `static` list means
    // nothing at all, and the palette then refuses to close for exactly the
    // person who has typed something. Measured, not defensive.
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      pop();
      return;
    }
    // Only when there is nothing to delete, so the key keeps its ordinary
    // meaning for as long as the person is still editing a term.
    if (event.key === 'Backspace' && term === '' && stack.length > 0) {
      event.preventDefault();
      pop();
    }
  };

  return (
    <Dialog
      open={open}
      // Headless UI routes Escape here. Popping rather than closing is what
      // makes the stack feel like a stack; at the root the two are the same.
      onClose={pop}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-s pt-[12vh]"
    >
      <div aria-hidden className="fixed inset-0 bg-black/40" />
      <DialogPanel
        data-testid="command-palette"
        className="relative w-full max-w-xl overflow-hidden rounded-lg border border-border bg-surface-elevated shadow-overlay"
      >
        <DialogTitle className="sr-only">{labels.title}</DialogTitle>

        {/*
          Uncontrolled: this combobox has no value worth holding — an option is
          an act, not a stored choice. Every render rebuilds its options from the
          sources, so the identities differ and selecting the same row twice
          still fires `onChange` both times.
        */}
        <Combobox<CommandOption> onChange={handleSelect}>
          <div className="flex items-center gap-2xs border-b border-border px-s py-2xs">
            {page.title !== undefined && (
              <button
                type="button"
                aria-label={labels.back}
                onClick={pop}
                className="shrink-0 rounded-md bg-surface px-2xs py-3xs text-step-xs text-content-muted focus-ring"
              >
                {page.title}
              </button>
            )}
            <ComboboxInput
              data-autofocus
              aria-label={labels.title}
              placeholder={page.placeholder}
              value={term}
              onChange={event => onTermChange(event.currentTarget.value)}
              onKeyDown={handleKeyDown}
              className="flex-1 bg-transparent py-3xs text-step-1 text-content placeholder:text-content-muted focus:outline-none"
            />
          </div>

          <ComboboxOptions
            static
            className={cn(
              'max-h-[60vh] overflow-y-auto p-3xs',
              // The panel is a focus-managed CONTAINER, not a target: the ring
              // belongs on the row inside it.
              'focus:outline-none',
            )}
          >
            {isEmpty ? (
              <div
                role="presentation"
                className="px-2xs py-s text-step-sm text-content-muted"
              >
                {labels.empty}
              </div>
            ) : (
              groups
                .filter(group => !groupIsEmpty(group))
                .map(group => (
                  <Group key={group.key} group={group} labels={labels} />
                ))
            )}
          </ComboboxOptions>
        </Combobox>
      </DialogPanel>
    </Dialog>
  );
}
