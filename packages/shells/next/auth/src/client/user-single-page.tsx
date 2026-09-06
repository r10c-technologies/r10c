'use client';

import { UserIdentity } from '@r10c/business-ts-authn';
import { EntityForm, useT } from '@r10c/entifix-react-controls';
import { useEntityUseCases } from '@r10c/entifix-react-integration';
import {
  deserializeSingleEntity,
  type EntityDraft,
  readDraftString,
} from '@r10c/entifix-ts-core';
import { makeEntityMetadataSource } from '@r10c/entifix-ts-rest-client';
import type { EntityCrudSingleViewProps } from '@r10c/shells-next-common';
import { useLocaleHref } from '@r10c/shells-next-common';
import { Effect } from 'effect';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { useAsyncResource } from './use-async-resource';
import { UserSessionsPanel } from './user-sessions-panel';

/**
 * Built once at module scope, not per render: it holds no state, and a new
 * object each render would change nothing but churn.
 *
 * A hand-written URL rather than the adapters' config-driven `compose` mode,
 * because this shell proxies auth-service through its host's own origin and has
 * no adapters context at all.
 */
const metadataSource = makeEntityMetadataSource({
  url: name => `/api/${name}/$metadata`,
});

const readUser = async (id: string): Promise<UserIdentity> => {
  const res = await fetch(`/api/user-identity/${id}`, { cache: 'no-store' });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body?.error ?? body?.message ?? 'could not load user');
  }
  return Effect.runSync(
    deserializeSingleEntity(UserIdentity, body),
  ) as UserIdentity;
};

/**
 * One user, in read or edit mode. `EntityForm` derives its fields from
 * `UserIdentity`'s metadata; only `role` and `status` are actually persisted,
 * because those are the two aspects auth-service's PATCH accepts — identifiers
 * and credentials are deliberately not editable from here.
 *
 * Dual-host, in the shape `makeEntityCrud`'s generated single view already has:
 * as a route it reads its id from the URL and reloads in place; in a workspace
 * tab it is handed the id, the post-save action and the draft store. This page
 * is hand-written rather than generated — auth-service's PATCH takes two aspects
 * and nothing else — so the seam is written out here instead of derived, but it
 * is deliberately the same seam, because the workspace registry hands every
 * record tab the same props.
 *
 * `useParams` is what makes the prop necessary rather than merely convenient:
 * under `/workspace` there is no dynamic segment, so it resolves to nothing and
 * a tab would render a form for a record with no id.
 */
export function UserDetailPage({
  slug,
  onSaved,
  draft,
}: EntityCrudSingleViewProps = {}) {
  const t = useT('shell');
  const errorT = useT('errors');
  // The back link is a plain `<a>` inside `EntityForm`, so an unprefixed href
  // costs a full document load *and* the middleware's redirect.
  const withLocale = useLocaleHref();
  const params = useParams<{ id: string }>();
  const id = slug ?? params.id;

  const {
    data: user,
    isLoading,
    error,
    reload,
  } = useAsyncResource(`user:${id}`, () => readUser(id));

  // What this caller may actually do with a user record, straight from the
  // service and already filtered against the verified principal. The form
  // renders Save, Delete and each declared verb from it, so a screen never
  // offers an action auth-service would refuse (ADR 0026).
  const { metadata, isLoading: isMetadataLoading } = useEntityUseCases(
    UserIdentity,
    metadataSource,
  );

  // Edits made since the record loaded; the loaded values are the fallback, so
  // the draft needs no effect to seed it.
  const [edits, setEdits] = useState<EntityDraft>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);

  // A persisted draft is layered over the loaded record, never substituted for
  // it: the record decides which members exist, the draft only decides their
  // values — `restoreEntityDraft`'s rule, applied by hand because this form is
  // not `useEntityForm`'s.
  const restored = draft?.draft as EntityDraft | undefined;
  const pending = useMemo(
    () => ({ ...restored, ...edits }),
    [restored, edits],
  );

  const values: EntityDraft = {
    displayName: user?.displayName ?? '',
    role: user?.role ?? '',
    status: user?.status ?? '',
    ...pending,
  };

  // Autosave, and the equality guard is load-bearing: `save` writes a fresh
  // object into the store, so the restored value's identity changes on every
  // write. Keyed on identity alone this effect would persist, observe its own
  // write, and persist again forever.
  const persist = draft?.save;
  useEffect(() => {
    if (Object.keys(edits).length === 0) return;
    if (JSON.stringify(pending) === JSON.stringify(restored)) return;
    persist?.(pending);
  }, [pending, restored, edits, persist]);

  const save = async () => {
    setIsSaving(true);
    setSaveError(undefined);
    const res = await fetch(`/api/user-identity/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        role: readDraftString(values, 'role'),
        status: readDraftString(values, 'status'),
      }),
    });
    const body = await res.json();
    setIsSaving(false);

    if (!res.ok) {
      // A 403 here is the policy refusing the change — typically an attempt to
      // touch a user who outranks the caller, or to demote yourself.
      setSaveError(body?.error ?? errorT('unexpected'));
      return;
    }
    setEdits({});
    // A draft is spent when the write commits, which is the one thing only this
    // page knows. A failed save deliberately keeps it.
    draft?.clear();
    if (onSaved !== undefined) {
      onSaved();
      return;
    }
    reload();
  };

  /**
   * A declared verb was invoked. `update-aspects` is what `save` already does —
   * the PATCH that writes role and status — and `revoke-sessions` is the
   * administrative sign-out. The form has already asked for confirmation where
   * the descriptor demanded it.
   *
   * Note what does not happen here: the use-case *class* is never imported. Its
   * `Effect` body, repository tags and whole import closure stay on the server;
   * the browser holds a key and a route.
   */
  const runUseCase = async (key: string) => {
    if (key === 'update-aspects') {
      await save();
      return;
    }
    if (key === 'revoke-sessions') {
      setIsSaving(true);
      const res = await fetch(`/api/user-identity/${id}/sessions`, {
        method: 'DELETE',
      });
      setIsSaving(false);
      if (!res.ok) {
        setSaveError(errorT('unexpected'));
        return;
      }
      reload();
    }
  };

  const message = saveError ?? error;

  return (
    <>
      {message ? (
        <p role="alert" className="text-danger">
          {message}
        </p>
      ) : null}
      <EntityForm
        entityConstructor={UserIdentity}
        entity={user}
        values={values}
        onFieldChange={(name, value) =>
          setEdits(current => ({ ...current, [name]: value }))
        }
        onSubmit={save}
        metadata={metadata}
        isMetadataLoading={isMetadataLoading}
        onUseCase={runUseCase}
        isLoading={isLoading}
        isSaving={isSaving}
        backHref={withLocale('/users')}
        title={user?.displayName ?? t('auth.users.fallbackName')}
      />
      <UserSessionsPanel userId={id} />
    </>
  );
}
