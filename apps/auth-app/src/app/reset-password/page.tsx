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
import { LocaleLink } from '@r10c/shells-next-common';
import { useSearchParams } from 'next/navigation';
import { type FormEvent, useState } from 'react';

const fieldClass =
  'w-full rounded-md border border-[var(--color-border,#d4d4d8)] bg-transparent px-s py-2xs text-base outline-none focus:border-[var(--color-accent,#6366f1)]';

/**
 * `/reset-password?token=…` — redeem a recovery link.
 *
 * Reachable signed in or out: someone may be signed in here and recovering
 * because they lost another device. The token stays in the query string only
 * long enough to be posted; it is single-use, so a copy left in history is
 * already spent.
 */
export default function ResetPasswordPage() {
  const t = useT('app');
  const errorT = useT('errors');
  const searchParams = useSearchParams();
  const token = searchParams?.get('token') ?? '';

  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get('newPassword') ?? '');
    if (newPassword !== String(form.get('confirmPassword') ?? '')) {
      setError(t('auth.password.mismatch'));
      return;
    }

    setPending(true);
    try {
      const res = await fetch('/api/auth/password/reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(errorT(data.code ?? 'unexpected'));
        return;
      }
      setDone(true);
    } catch {
      setError(errorT('network'));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md items-center px-s py-l">
      <Stack gap="l" className="w-full">
        <header>
          <Stack gap="2xs">
            <Overline>{t('auth.reset.overline')}</Overline>
            <HeadingOne>{t('auth.reset.title')}</HeadingOne>
            <Lead>{t('auth.reset.subtitle')}</Lead>
          </Stack>
        </header>

        <Card>
          {token === '' ? (
            <Text role="alert" className="text-danger">
              {t('auth.reset.missingToken')}
            </Text>
          ) : done ? (
            <Text>{t('auth.reset.done')}</Text>
          ) : (
            <form onSubmit={onSubmit}>
              <Stack gap="s">
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

                <Button
                  type="submit"
                  variant="primary"
                  size="lg"
                  disabled={pending}
                >
                  {pending ? t('auth.reset.saving') : t('auth.reset.submit')}
                </Button>
              </Stack>
            </form>
          )}
        </Card>

        <footer>
          <Text muted>
            <LocaleLink href="/" className="underline">
              {t('auth.forgot.backToSignIn')}
            </LocaleLink>
          </Text>
        </footer>
      </Stack>
    </main>
  );
}
