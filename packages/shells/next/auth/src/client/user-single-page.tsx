'use client';

import { UserIdentity } from '@r10c/business-ts-authn';
import { EntityForm, useT } from '@r10c/entifix-react-controls';
import { deserializeSingleEntity } from '@r10c/entifix-ts-core';
import { useLocaleHref } from '@r10c/shells-next-common';
import { Effect } from 'effect';
import { useParams } from 'next/navigation';
import { useState } from 'react';

import { useAsyncResource } from './use-async-resource';
import { UserSessionsPanel } from './user-sessions-panel';

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
        isLoading={isLoading}
        isSaving={isSaving}
        backHref={withLocale('/users')}
        title={user?.displayName ?? t('auth.users.fallbackName')}
      />
      <UserSessionsPanel userId={id} />
    </>
  );
}
