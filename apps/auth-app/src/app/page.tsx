'use client';

import {
  ButtonLink,
  Card,
  HeadingOne,
  Lead,
  Overline,
  Stack,
  Text,
  useT,
} from '@r10c/entifix-react-controls';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

/** The error codes the callback and start routes can hand back on the URL. */
const SIGN_IN_ERRORS = [
  'providerUnavailable',
  'invalidState',
  'accountInactive',
  'accessDenied',
  'invalidRequest',
] as const;

type SignInError = (typeof SIGN_IN_ERRORS)[number];

const isSignInError = (value: string | null): value is SignInError =>
  value !== null && SIGN_IN_ERRORS.includes(value as SignInError);

/**
 * auth-app landing (port 3002) — the sign-in surface, reduced to one action.
 *
 * There is no form here and there cannot be: this app holds no credential to
 * collect. The button is an ordinary link to a server route that redirects to
 * Zitadel's hosted login, which is what makes signing up, recovering an account
 * and enrolling a second factor configuration rather than screens we maintain.
 *
 * A plain `<a>` rather than a client fetch, so the whole flow works before any
 * JavaScript has run — the one page in the fleet where that matters most.
 */
function SignIn() {
  const t = useT('app');
  const params = useSearchParams();
  const error = params.get('error');

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
          <Stack gap="m">
            {/* An unrecognised code is reported as `unexpected` rather than
                rendered raw: whatever produced it came from outside. */}
            {error === null ? null : (
              <Text className="text-danger" role="alert">
                {isSignInError(error)
                  ? t(`auth.signIn.errors.${error}`)
                  : t('auth.signIn.errors.unexpected')}
              </Text>
            )}
            <Text muted>{t('auth.signIn.hosted')}</Text>
            <ButtonLink href="/api/auth/oidc/start">
              {t('auth.signIn.continue')}
            </ButtonLink>
          </Stack>
        </Card>
      </Stack>
    </main>
  );
}

/**
 * `useSearchParams` opts a client component into a Suspense boundary; without
 * one Next fails the build rather than the render.
 */
export default function Index() {
  return (
    <Suspense>
      <SignIn />
    </Suspense>
  );
}
