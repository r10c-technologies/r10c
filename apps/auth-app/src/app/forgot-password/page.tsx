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
import { type FormEvent, useState } from 'react';

const fieldClass =
  'w-full rounded-md border border-[var(--color-border,#d4d4d8)] bg-transparent px-s py-2xs text-base outline-none focus:border-[var(--color-accent,#6366f1)]';

/**
 * `/forgot-password` — ask for a recovery link.
 *
 * The confirmation is deliberately the same whether or not the account exists,
 * matching what the service answers. Saying "no such account" here would undo
 * the enumeration protection the whole flow is built around.
 */
export default function ForgotPasswordPage() {
  const t = useT('app');
  const errorT = useT('errors');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    try {
      await fetch('/api/auth/password/forgot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          identifier: String(form.get('identifier') ?? ''),
        }),
      });
      setSent(true);
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
            <Overline>{t('auth.forgot.overline')}</Overline>
            <HeadingOne>{t('auth.forgot.title')}</HeadingOne>
            <Lead>{t('auth.forgot.subtitle')}</Lead>
          </Stack>
        </header>

        <Card>
          {sent ? (
            <Text>{t('auth.forgot.sent')}</Text>
          ) : (
            <form onSubmit={onSubmit}>
              <Stack gap="s">
                <label>
                  <Text muted>{t('auth.forgot.identifier')}</Text>
                  <input
                    name="identifier"
                    autoComplete="username"
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
                  {pending
                    ? t('auth.forgot.sending')
                    : t('auth.forgot.submit')}
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
