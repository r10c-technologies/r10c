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

import { CredentialForm } from '../_components/credential-form';

/**
 * Self-registration. Collects a display name plus one or more identifiers
 * (email and/or username) and a password; on success the account is created and
 * logged straight in. Bare-bones on purpose — a control surface for the auth
 * layer, not a finished onboarding flow.
 */
export default function SignUp() {
  const t = useT('app');

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md items-center px-s py-l">
      <Stack gap="l" className="w-full">
        <header>
          <Stack gap="2xs">
            <Overline>{t('auth.signUp.overline')}</Overline>
            <HeadingOne>{t('auth.signUp.title')}</HeadingOne>
            <Lead>{t('auth.signUp.subtitle')}</Lead>
          </Stack>
        </header>

        <Card>
          <CredentialForm mode="register" />
        </Card>

        <Text muted>
          {t('auth.signUp.haveAccount')}{' '}
          <LocaleLink href="/" className="underline">
            {t('auth.signUp.signIn')}
          </LocaleLink>
        </Text>
      </Stack>
    </main>
  );
}
