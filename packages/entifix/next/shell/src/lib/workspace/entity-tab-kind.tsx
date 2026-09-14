'use client';

import { parseScreenPayload, type ScreenType } from '@r10c/business-ts-authz';
import type { ReactNode } from 'react';

import type { TabKind } from './tab-kind';

/** One list a workspace may open — the collection half of a screen. */
export interface EntityTabList {
  /** The tab caption's catalog key. `@entity({ pluralKey })` for a generated screen. */
  readonly titleKey: string;
  render(): ReactNode;
}

/** One record a workspace may open — the same screen, with an id. */
export interface EntityTabRecord {
  /** The tab caption's catalog key. `@entity({ labelKey })` for a generated screen. */
  readonly labelKey: string;
  render(id: string): ReactNode;
}

export interface EntityTabScreens {
  readonly lists: Record<string, EntityTabList>;
  readonly records: Record<string, EntityTabRecord>;
}

/**
 * An entity tab kind: `<type>:<key>` for a list, `<type>:<key>:<id>` for one
 * record.
 *
 * **The list and the record are not different kinds.** They are the same screen
 * with and without a record, which is exactly what the optional id in the
 * payload says — three kinds (`catalog:`, `entity:`, `system:`) collapsed into
 * one for that reason, and the prefix names the *taxonomy* now
 * ([ADR 0042](../../../../../../../docs/adr/0042-the-workspace-address-is-the-taxonomy-serialized.md)).
 *
 * A factory over the {@link ScreenType} rather than a constant, and that is the
 * whole of what makes an Operaciones screen addressable. It was written inline
 * in back-office-app as a `masterKind`, so `master:` was the only entity
 * address any host could resolve and `operation:` matched nothing at all — a
 * second copy of this parser beside it is exactly the drift the registry was
 * consolidated to stop, and the two would have had to agree about a grammar
 * neither owns.
 *
 * Which screens a host offers stays the host's decision — a second host
 * mounting the same shells may want a different set — so the screens arrive as
 * an argument. What no longer varies is how one is addressed.
 *
 * `render` takes the id rather than a component, so the caller decides what
 * hosting a record means: in a workspace that is an editor wired to an
 * address-keyed autosaved draft, and the address it keys on has to carry this
 * same `type`.
 */
export function entityTabKind(
  type: ScreenType,
  screens: EntityTabScreens,
): TabKind<{ key: string; id?: string }> {
  return {
    kind: type,
    match: payload => {
      const parsed = parseScreenPayload(payload);
      if (parsed === null) return null;
      // A key is valid for the half it names: a record address for a screen
      // with a list and no record editor resolves to nothing, and the workspace
      // answers with its fallback rather than rendering an empty editor.
      const known =
        parsed.id === undefined
          ? parsed.key in screens.lists
          : parsed.key in screens.records;
      return known ? parsed : null;
    },
    toParam: addr =>
      addr.id === undefined ? addr.key : `${addr.key}:${addr.id}`,
    title: (addr, translate) =>
      addr.id === undefined
        ? translate(screens.lists[addr.key].titleKey)
        : `${translate(screens.records[addr.key].labelKey)} #${addr.id}`,
    render: addr =>
      addr.id === undefined
        ? screens.lists[addr.key].render()
        : screens.records[addr.key].render(addr.id),
  };
}
