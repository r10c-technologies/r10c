'use client';
import type { EntifixFailure, EntityDraft } from '@entifix/core';
import { useLocaleHref } from '@entifix/next-shell';
import {
  EntityField,
  EntityForm,
  TextInput,
  useErrorMessage,
  useT,
} from '@entifix/react-controls';
import { UserIdentity } from '@r10c/business-ts-authn';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { failedResponse } from './failed-response';

/** The address a new user signs in with: not a member of `UserIdentity`. */
const EMAIL = 'email';

/**
 * Create a user, on `EntityForm` like every other record screen, so the role
 * select, the labels, the validation and the save row are the design system's
 * rather than a second copy of them (a1-16).
 *
 * Creation is not quite an entity write: it carries an email that
 * `UserIdentity` holds as an identifier rather than a member, and it runs the
 * same registration use-case a first sign-in does. So `displayName` and `role`
 * are the entity's own fields, `email` is a field the form adds (a slot with no
 * backing member), and the members registration does not take — the id, the
 * status, the identifiers collection — are left out.
 *
 * There is no password field, and adding one back would be a mistake rather
 * than a convenience: r10c has nowhere to put it. The route creates the local
 * record and then the Zitadel human, and the person receives an invitation from
 * the provider to set their own credential.
 *
 * The role select offers every tier; auth-service rejects anything above the
 * caller's own, which is the check that counts.
 */
export function NewUserPage() {
  const t = useT('r10c');
  const errorMessage = useErrorMessage();
  const router = useRouter();
  // Every internal navigation carries the locale, or the proxy bounces it.
  const withLocale = useLocaleHref();
  const [draft, setDraft] = useState<EntityDraft>({
    [EMAIL]: '',
    displayName: '',
    role: 'user',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [failure, setFailure] = useState<EntifixFailure | undefined>(undefined);

  const submit = async (submitted: EntityDraft) => {
    setIsSaving(true);
    setFailure(undefined);

    const res = await fetch('/api/user-identity', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        displayName: submitted['displayName'],
        role: submitted['role'],
        identifiers: [{ type: 'email', value: submitted[EMAIL] }],
      }),
    });
    setIsSaving(false);

    if (!res.ok) {
      setFailure(await failedResponse(res));
      return;
    }
    router.push(withLocale('/users'));
    router.refresh();
  };

  return (
    <EntityForm
      entityConstructor={UserIdentity}
      values={draft}
      onFieldChange={(name, value) =>
        setDraft(current => ({ ...current, [name]: value }))
      }
      onSubmit={draft => void submit(draft)}
      formError={failure === undefined ? undefined : errorMessage(failure)}
      isSaving={isSaving}
      backHref={withLocale('/users')}
      title={t('auth.users.newTitle')}
    >
      <EntityField<UserIdentity> field="id" hidden />
      <EntityField<UserIdentity> field="status" hidden />
      <EntityField<UserIdentity> field="identifiers" hidden />
      <EntityField<UserIdentity>
        field={EMAIL}
        label={t('auth.fields.email')}
        order={0}
        render={({ id, value, setField }) => (
          <TextInput
            id={id}
            type="email"
            autoComplete="off"
            required
            value={value}
            onChange={event => setField(EMAIL, event.currentTarget.value)}
          />
        )}
      />
    </EntityForm>
  );
}
