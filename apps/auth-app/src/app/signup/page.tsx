'use client';

import {
  Card,
  HeadingOne,
  Lead,
  Overline,
  Stack,
  Text,
} from '@r10c/entifix-react-controls';
import Link from 'next/link';

import { CredentialForm } from '../_components/credential-form';

/**
 * Self-registration. Collects a display name plus one or more identifiers
 * (email and/or username) and a password; on success the account is created and
 * logged straight in. Bare-bones on purpose — a control surface for the auth
 * layer, not a finished onboarding flow.
 */
export default function SignUp() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md items-center px-s py-l">
      <Stack gap="l" className="w-full">
        <header>
          <Stack gap="2xs">
            <Overline>Identity</Overline>
            <HeadingOne>Create account</HeadingOne>
            <Lead>Register with an email and/or a username.</Lead>
          </Stack>
        </header>

        <Card>
          <CredentialForm mode="register" />
        </Card>

        <Text muted>
          Already have an account?{' '}
          <Link href="/" className="underline">
            Sign in
          </Link>
        </Text>
      </Stack>
    </main>
  );
}
