'use client';

import { Button, Stack, Text } from '@r10c/entifix-react-controls';
import { type FormEvent, useState } from 'react';

type Mode = 'login' | 'register';

interface Identifier {
  type: string;
  value: string;
}

const fieldClass =
  'w-full rounded-md border border-[var(--color-border,#d4d4d8)] bg-transparent px-s py-2xs text-base outline-none focus:border-[var(--color-accent,#6366f1)]';

/**
 * The one credential form, in login or register mode. Deliberately plain — this
 * is the control surface for testing the auth layer, not a finished sign-in UX.
 * It posts to this app's server route handlers (which own the cookies) and, on
 * success, navigates to the redirect the handler chose.
 */
export function CredentialForm({ mode }: { mode: Mode }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');

    let url: string;
    let payload: Record<string, unknown>;
    if (mode === 'login') {
      url = '/api/auth/login';
      payload = { identifier: String(form.get('identifier') ?? ''), password };
    } else {
      const identifiers: Identifier[] = [];
      const email = String(form.get('email') ?? '').trim();
      const username = String(form.get('username') ?? '').trim();
      if (email) identifiers.push({ type: 'email', value: email });
      if (username) identifiers.push({ type: 'username', value: username });
      url = '/api/auth/register';
      payload = {
        displayName: String(form.get('displayName') ?? '').trim() || undefined,
        identifiers,
        password,
      };
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Something went wrong');
        setPending(false);
        return;
      }
      window.location.href = data.redirect ?? '/';
    } catch {
      setError('Network error — is auth-service running?');
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <Stack gap="s">
        {mode === 'login' ? (
          <label>
            <Text muted>Email, username or phone</Text>
            <input
              name="identifier"
              autoComplete="username"
              required
              className={fieldClass}
            />
          </label>
        ) : (
          <>
            <label>
              <Text muted>Display name</Text>
              <input name="displayName" className={fieldClass} />
            </label>
            <label>
              <Text muted>Email</Text>
              <input
                name="email"
                type="email"
                autoComplete="email"
                className={fieldClass}
              />
            </label>
            <label>
              <Text muted>Username</Text>
              <input name="username" className={fieldClass} />
            </label>
          </>
        )}

        <label>
          <Text muted>Password</Text>
          <input
            name="password"
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            className={fieldClass}
          />
        </label>

        {error !== null && (
          <Text className="text-[var(--color-danger,#dc2626)]">{error}</Text>
        )}

        <Button type="submit" variant="primary" size="lg" disabled={pending}>
          {pending
            ? 'Please wait…'
            : mode === 'login'
              ? 'Sign in'
              : 'Create account'}
        </Button>
      </Stack>
    </form>
  );
}
