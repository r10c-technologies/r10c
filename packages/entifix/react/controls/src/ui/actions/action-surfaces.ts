import {
  EntifixLogicError,
  type UseCaseBinding,
  type UseCaseDescriptor,
  type UseCasePlacement,
} from '@r10c/entifix-ts-core';

/**
 * Where a declared verb is rendered.
 *
 * ADR 0026 gave a use case two independent axes and then built only one
 * surface, so four of the nine cells had nowhere to go: `EntityForm` filtered
 * `binding === 'entity' && placement !== 'context-dependent'` and everything
 * else was dropped without a word. This is the map that closes it —
 * **placement decides the surface, binding decides the payload** — and it lives
 * in one module so no surface re-derives it and the two axes cannot drift
 * apart again ([ADR 0035](../../../../../../docs/adr/0035-entity-actions-selection-and-bulk.md)).
 */
export const ACTION_SURFACES = [
  'form-header',
  'form-footer',
  'row-menu',
  'bulk-bar',
  'table-toolbar',
  'command-palette',
] as const;
export type ActionSurface = (typeof ACTION_SURFACES)[number];

/**
 * The nine cells, exhaustively.
 *
 * `collection` + `determining` is deliberately absent, and asking for it
 * throws rather than returning `undefined`. A determining action *finalizes a
 * page* — it is the footer that ends an object page — and a list screen has no
 * such thing to finalize, which is Fiori's own rule. Dropping it silently is
 * the fault this repo already writes an assertion against elsewhere: the verb
 * would be declared, granted, exported, pass every `@r10c/slices` invariant,
 * and simply never appear, which reads to its author as "the permission is
 * wrong" and sends them looking in the wrong place entirely.
 */
const SURFACE_BY_CELL: Record<string, ActionSurface> = {
  'entity:context-independent': 'form-header',
  'entity:determining': 'form-footer',
  'entity:context-dependent': 'row-menu',
  'collection:context-dependent': 'bulk-bar',
  'collection:context-independent': 'table-toolbar',
  'unbound:context-dependent': 'command-palette',
  'unbound:context-independent': 'command-palette',
  'unbound:determining': 'command-palette',
};

/**
 * The overflow trigger's glyph.
 *
 * A constant rather than a literal in JSX, because `react/jsx-no-literals`
 * fails the build on written-in copy and is right to: it cannot tell a
 * typographic glyph from a forgotten Spanish string. The trigger's *name* is a
 * catalog key (`form.moreActions`, `table.actions`) — this is only the mark,
 * and it is never read aloud.
 */
export const OVERFLOW_GLYPH = '\u22ef';

/** Which surface renders one cell. Throws on a cell no surface owns. */
function surfaceForCell(
  key: string,
  binding: UseCaseBinding,
  placement: UseCasePlacement,
): ActionSurface {
  const surface = SURFACE_BY_CELL[`${binding}:${placement}`];

  if (surface === undefined) {
    throw new EntifixLogicError(
      `The use case "${key}" is declared ${binding} + ${placement}, which no surface renders. ` +
        'A `determining` action finalizes a page — it is an object page’s footer — and a list ' +
        'screen has no page to finalize, so a collection-bound verb cannot be determining. ' +
        'Declare it `context-dependent` to reach the bulk bar, or `context-independent` to sit ' +
        'in the table toolbar.',
      undefined,
      { key, binding, placement },
    );
  }

  return surface;
}

/**
 * Every surface this descriptor renders on.
 *
 * ⚠️ **A verb may name more than one cell**, and that is what makes publishing
 * reachable from a form header, a row menu and a selection without becoming
 * three permissions (#216). The primary `binding` + `placement` come first, then
 * whatever `alsoAt` adds, and each is validated the same way — an illegal cell
 * in `alsoAt` throws exactly as one in the primary pair does.
 *
 * Duplicates are collapsed. A descriptor that named the same cell twice would
 * otherwise render the verb twice in one menu, which reads as a bug in the
 * screen rather than in the declaration.
 */
export function surfacesFor(
  descriptor: UseCaseDescriptor,
): readonly ActionSurface[] {
  const cells = [
    { binding: descriptor.binding, placement: descriptor.placement },
    ...(descriptor.alsoAt ?? []),
  ];

  return [
    ...new Set(
      cells.map(cell =>
        surfaceForCell(descriptor.key, cell.binding, cell.placement),
      ),
    ),
  ];
}

/**
 * The single surface this descriptor renders on.
 *
 * Kept for the callers that genuinely have one — the command palette asks "is
 * this mine?" of an `unbound` verb, which can only ever be in one place. Any
 * caller that renders a *list* of verbs wants {@link surfacesFor}.
 */
export function surfaceFor(descriptor: UseCaseDescriptor): ActionSurface {
  return surfaceForCell(
    descriptor.key,
    descriptor.binding,
    descriptor.placement,
  );
}

/**
 * The descriptors one surface should render, in declaration order.
 *
 * Every descriptor is passed through {@link surfacesFor}, so an unrenderable
 * cell throws on the **first render of any surface** rather than only on the
 * one that would have shown it — the same reason
 * `assertLinkSourcesAreEditable` runs as one pass over the registry instead of
 * per row: a check that only fires on the screen that was already looking for
 * the verb is a check that fires after the bug is reported. A cell declared in
 * `alsoAt` is validated on that same first render, not on the surface it names.
 */
export function useCasesForSurface(
  surface: ActionSurface,
  useCases: readonly UseCaseDescriptor[] | undefined,
): UseCaseDescriptor[] {
  return (useCases ?? []).filter(descriptor =>
    surfacesFor(descriptor).includes(surface),
  );
}
