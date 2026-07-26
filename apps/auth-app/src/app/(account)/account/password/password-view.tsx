'use client';

import {
  Button,
  Card,
  HeadingOne,
  Lead,
  Overline,
  Stack,
  Text,
  useT,
} from '@r10c/entifix-react-controls';
import { type FormEvent, useState } from 'react';

const fieldClass =
  'w-full rounded-md border border-[var(--color-border,#d4d4d8)] bg-transparent px-s py-2xs text-base outline-none focus:border-[var(--color-accent,#6366f1)]';

/**
 * Change your own password.
 *
 * Hand-written rather than `EntityForm`, following the precedent set by
 * `users/new`: a credential is not an entity member, and rendering one from
 * metadata would put a password into the generic form machinery.
 */
export function PasswordView() {
  const t = useT('app');
  const errorT = useT('errors');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setDone(false);

    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get('newPassword') ?? '');
    if (newPassword !== String(form.get('confirmPassword') ?? '')) {
      // Checked here because only the browser knows what was typed twice; the
      // service is given one password and has nothing to compare it against.
      setError(t('auth.password.mismatch'));
      return;
    }

    setPending(true);
    try {
      const res = await fetch('/api/auth/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          currentPassword: String(form.get('currentPassword') ?? ''),
          newPassword,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(errorT(data.code ?? 'unexpected'));
        return;
      }
      setDone(true);
      event.currentTarget?.reset();
    } catch {
      setError(errorT('network'));
    } finally {
      setPending(false);
    }
  }

  return (
    <Stack gap="l">
      <header>
        <Stack gap="2xs">
          <Overline>{t('auth.password.overline')}</Overline>
          <HeadingOne>{t('auth.password.title')}</HeadingOne>
          <Lead>{t('auth.password.subtitle')}</Lead>
        </Stack>
      </header>

      <Card>
        <form onSubmit={onSubmit}>
          <Stack gap="s">
            <label>
              <Text muted>{t('auth.password.current')}</Text>
              <input
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
                className={fieldClass}
              />
            </label>
            <label>
              <Text muted>{t('auth.password.next')}</Text>
              <input
                name="newPassword"
                type="password"
                autoComplete="new-password"
                required
                className={fieldClass}
              />
            </label>
            <label>
              <Text muted>{t('auth.password.confirm')}</Text>
              <input
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                className={fieldClass}
              />
            </label>

            {error === null ? null : (
              <Text role="alert" className="text-danger">
                {error}
              </Text>
            )}
            {done ? <Text>{t('auth.password.changed')}</Text> : null}

            <Button type="submit" variant="primary" size="lg" disabled={pending}>
              {pending ? t('auth.password.saving') : t('auth.password.submit')}
            </Button>
          </Stack>
        </form>
      </Card>
    </Stack>
  );
}
