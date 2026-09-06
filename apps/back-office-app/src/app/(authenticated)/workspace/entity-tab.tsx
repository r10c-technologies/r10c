'use client';

import { screenAddress } from '@r10c/business-ts-authz';
import type { EntityCrudSingleViewProps } from '@r10c/shells-next-common';
import { useEntityDraft, useTabEntityNav } from '@r10c/shells-next-common';
import type { ReactElement } from 'react';

/**
 * An entity editor hosted in a workspace tab, with continuous autosave: every
 * field edit is persisted to the address-keyed draft (IndexedDB), the form
 * seeds from that draft on mount so a refresh restores the edit, and the draft
 * is cleared once the real Save or Delete commits.
 *
 * All of that is `useEntityDraft` — one hook, handed to the generated page as a
 * port. It used to be per-entity plumbing (`initialDraft` / `onDraftChange`
 * threaded through the page), which is why brands and categories had no
 * autosave at all: nobody had written their copy of it (#131).
 *
 * The same fact drives the tab's dirty marker and its close confirmation,
 * because `WorkspaceShell` reads the draft store directly.
 *
 * `Page` arrives as a prop rather than being looked up in a const map here. That
 * map was one of three that restated the same entity keys, and the one whose
 * absence was silent: a key missing from it opened a tab onto nothing. The
 * registry derives it from the generated screens now.
 *
 * The draft address is `screenAddress`, the same builder the registry and the
 * nav use. It used to be spelled out here as a template literal — the third
 * spelling of a grammar that had to agree with itself at five call sites, and
 * the one whose drift silently detached a tab from its own autosaved draft.
 */
export function EntityEditorTab({
  entityKey,
  id,
  Page,
}: {
  entityKey: string;
  id: string;
  Page: (props?: EntityCrudSingleViewProps) => ReactElement;
}) {
  const nav = useTabEntityNav();
  const draft = useEntityDraft(
    screenAddress({ type: 'master', key: entityKey, id }),
  );

  const done = () => nav.toList(entityKey);

  return <Page slug={id} draft={draft} onSaved={done} onDeleted={done} />;
}
