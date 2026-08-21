'use client';

import { UserIdentity } from '@r10c/business-ts-authn';
import { EntityForm, useT } from '@r10c/entifix-react-controls';
import { useEntityUseCases } from '@r10c/entifix-react-integration';
import { deserializeSingleEntity } from '@r10c/entifix-ts-core';
import { makeEntityMetadataSource } from '@r10c/entifix-ts-rest-client';
import { useLocaleHref } from '@r10c/shells-next-common';
import { Effect } from 'effect';
import { useParams } from 'next/navigation';
import { useState } from 'react';

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
 */
export function UserDetailPage() {
  const t = useT('shell');
  const errorT = useT('errors');
  // The back link is a plain `<a>` inside `EntityForm`, so an unprefixed href
  // costs a full document load *and* the middleware's redirect.
  const withLocale = useLocaleHref();
  const params = useParams<{ id: string }>();
  const id = params.id;

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
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | undefined>(undefined);

  const values: Record<string, string> = {
    displayName: user?.displayName ?? '',
    role: user?.role ?? '',
    status: user?.status ?? '',
    ...edits,
  };

  const save = async () => {
    setIsSaving(true);
    setSaveError(undefined);
    const res = await fetch(`/api/user-identity/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: values.role, status: values.status }),
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
