'use client';

import { Roles } from '@r10c/business-ts-authz';
import {
  Button,
  Card,
  Select,
  Stack,
  TextInput,
  useT,
} from '@r10c/entifix-react-controls';
import { useRouter } from 'next/navigation';
import { type FormEvent, type ReactNode, useState } from 'react';

/**
 * Create a user. Deliberately a hand-written form rather than `EntityForm`:
 * creation is not an entity write. It carries an identifier that `UserIdentity`
 * does not model, and it runs the same registration use-case a first sign-in
 * does — so the fields are that use-case's inputs, not the entity's members.
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
  const t = useT('shell');
  const errorT = useT('errors');
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<string>('user');
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | undefined>(undefined);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setIsSaving(true);
    setMessage(undefined);

    const res = await fetch('/api/user-identity', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        displayName,
        role,
        identifiers: [{ type: 'email', value: email }],
      }),
    });
    const body = await res.json();
    setIsSaving(false);

    if (!res.ok) {
      setMessage(body?.error ?? errorT('unexpected'));
      return;
    }
    router.push('/users');
    router.refresh();
  };

  const field = (id: string, label: string, control: ReactNode) => (
    <Stack gap="3xs">
      <label htmlFor={id} className="text-step-sm text-content-muted">
        {label}
      </label>
      {control}
    </Stack>
  );

  return (
    <Card>
      <form onSubmit={submit}>
        <Stack gap="s">
          <h1 className="text-step-1 font-semibold">
            {t('auth.users.newTitle')}
          </h1>
          {message ? (
            <p role="alert" className="text-danger">
              {message}
            </p>
          ) : null}

          {field(
            'new-user-email',
            t('auth.fields.email'),
            <TextInput
              id="new-user-email"
              type="email"
              value={email}
              required
              onChange={event => setEmail(event.currentTarget.value)}
            />,
          )}
          {field(
            'new-user-display-name',
            t('auth.fields.displayName'),
            <TextInput
              id="new-user-display-name"
              value={displayName}
              onChange={event => setDisplayName(event.currentTarget.value)}
            />,
          )}
          {field(
            'new-user-role',
            t('auth.fields.role'),
            <Select
              id="new-user-role"
              value={role}
              onChange={event => setRole(event.currentTarget.value)}
            >
              {Roles.map(option => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>,
          )}

          <Button type="submit" disabled={isSaving}>
            {isSaving ? t('auth.submit.creating') : t('auth.submit.createUser')}
          </Button>
        </Stack>
      </form>
    </Card>
  );
}
