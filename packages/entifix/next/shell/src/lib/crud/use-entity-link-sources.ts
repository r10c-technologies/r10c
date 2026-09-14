'use client';

import { useEntityLinkSource } from '@r10c/entifix-react-integration';
import {
  type Entity,
  type EntityDraft,
  type EntityLinkSelection,
  type EntityLinkSource,
  readDraftString,
} from '@r10c/entifix-ts-core';

import type { EntityCrudLinkSource } from './make-entity-crud.types';

export interface UseEntityLinkSourcesOptions {
  /** The form's current draft — ids are the truth. */
  readonly values: EntityDraft;
  /** The picked-instance sidecar, so a chosen name needs no round trip. */
  readonly selection: EntityLinkSelection;
}

/**
 * Turns a fixed list of pickers into the `linkSources` map `EntityForm` takes.
 *
 * **Why the rule is disabled below.** `links` is built once, at factory time,
 * and closed over by the generated form — it is the same array object on every
 * render of a given component, so the hook count is fixed. That is exactly the
 * invariant `react-hooks/rules-of-hooks` exists to protect and exactly the one
 * it cannot see, because it reasons syntactically about the loop rather than
 * about the array's provenance. The loop is isolated in this module so the
 * disable is written once, with its reason, instead of once per generated form.
 *
 * The alternative — one child component per picker, reporting its source
 * upward — would put the sources one render behind the draft that feeds them,
 * which is a stale suggestion list rather than a lint error.
 */
export function useEntityLinkSources(
  links: readonly EntityCrudLinkSource[],
  { values, selection }: UseEntityLinkSourcesOptions,
): Record<string, EntityLinkSource<Entity>> {
  const sources: Record<string, EntityLinkSource<Entity>> = {};
  for (const link of links) {
    // Read as a string: a relation's draft value is a foreign key, and a
    // member that came back from storage in any other shape must read as unset
    // rather than be handed to the picker as an id.
    const held = readDraftString(values, link.field);
    // eslint-disable-next-line react-hooks/rules-of-hooks -- fixed-length loop over a factory-time array; see the note above.
    sources[link.field] = useEntityLinkSource(link.config, {
      descriptor: link.descriptor,
      // An empty draft entry is "unset", not an id. Nothing enforces the
      // reference across a store boundary, so `''` would be a dangling id.
      selectedId: held === '' ? undefined : held,
      selectedEntity: selection[link.field],
    });
  }
  return sources;
}
