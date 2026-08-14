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
 * back-office-app's front door (port 3001) — the sign-in surface, reduced to
 * one action. Same origin as everything behind it now, so the round trip never
 * leaves this host.
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

  // Where the visitor was refused, carried here by the middleware. Forwarded
  // untouched and unvalidated: `oidcStartRoute` stashes it server-side with the
  // pending authorization and `safeRedirect` re-checks it against the allowlist
  // on the way back, deliberately — a value that made a round trip through a
  // third party is not ours until it has been re-checked. Validating here would
  // read as the security boundary while being trivially bypassable.
  const redirect = params.get('redirect');
  const startHref =
    redirect === null
      ? '/api/auth/oidc/start'
      : `/api/auth/oidc/start?redirect=${encodeURIComponent(redirect)}`;

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
            <ButtonLink href={startHref}>
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
