'use client';

import { Button, Stack, Text, useT } from '@r10c/entifix-react-controls';
import { useSearchParams } from 'next/navigation';
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
  const t = useT('app');
  const errorT = useT('errors');
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Where the visitor was headed before being asked to sign in. Passed through
  // to the handler, which validates it against the allowlist — it is not
  // trusted just because it arrived in our own URL.
  const redirect = searchParams?.get('redirect') ?? undefined;

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
      payload = {
        identifier: String(form.get('identifier') ?? ''),
        password,
        redirect,
      };
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
        setError(data.error ?? errorT('unexpected'));
        setPending(false);
        return;
      }
      window.location.href = data.redirect ?? '/';
    } catch {
      setError(errorT('network'));
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit}>
      <Stack gap="s">
        {mode === 'login' ? (
          <label>
            <Text muted>{t('auth.fields.identifier')}</Text>
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
              <Text muted>{t('auth.fields.displayName')}</Text>
              <input name="displayName" className={fieldClass} />
            </label>
            <label>
              <Text muted>{t('auth.fields.email')}</Text>
              <input
                name="email"
                type="email"
                autoComplete="email"
                className={fieldClass}
              />
            </label>
            <label>
              <Text muted>{t('auth.fields.username')}</Text>
              <input name="username" className={fieldClass} />
            </label>
          </>
        )}

        <label>
          <Text muted>{t('auth.fields.password')}</Text>
          <input
            name="password"
            type="password"
            autoComplete={
              mode === 'login' ? 'current-password' : 'new-password'
            }
            required
            className={fieldClass}
          />
        </label>

        {error !== null && (
          <Text className="text-[var(--color-danger,#dc2626)]">{error}</Text>
        )}

        <Button type="submit" variant="primary" size="lg" disabled={pending}>
          {pending
            ? t('auth.submit.wait')
            : mode === 'login'
              ? t('auth.submit.signIn')
              : t('auth.submit.createAccount')}
        </Button>
      </Stack>
    </form>
  );
}
