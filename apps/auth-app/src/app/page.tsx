'use client';

import {
  Card,
  HeadingOne,
  Lead,
  Overline,
  Stack,
  Text,
  useT,
} from '@r10c/entifix-react-controls';
import { LocaleLink } from '@r10c/shells-next-common';

import { CredentialForm } from './_components/credential-form';

/**
 * auth-app landing (port 3002) — the sign-in surface. A credential form posting
 * to this app's server route handlers, which exchange the credentials with
 * auth-service and set the session cookies. Zitadel-hosted login can slot in
 * later behind the same route handlers.
 */
export default function Index() {
  const t = useT('app');

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md items-center px-s py-l">
      <Stack gap="l" className="w-full">
        <header>
          <Stack gap="2xs">
            <Overline>{t('auth.signIn.overline')}</Overline>
            <HeadingOne>{t('auth.signIn.title')}</HeadingOne>
            <Lead>{t('auth.signIn.subtitle')}</Lead>
          </Stack>
        </header>

        <Card>
          <CredentialForm mode="login" />
        </Card>

        <Stack gap="2xs">
          <Text muted>
            {t('auth.signIn.noAccount')}{' '}
            <LocaleLink href="/signup" className="underline">
              {t('auth.signIn.create')}
            </LocaleLink>
          </Text>
          {/* Without this the recovery flow exists but nobody can reach it. */}
          <Text muted>
            <LocaleLink href="/forgot-password" className="underline">
              {t('auth.forgot.title')}
            </LocaleLink>
          </Text>
        </Stack>
      </Stack>
    </main>
  );
}
