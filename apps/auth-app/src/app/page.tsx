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

import { CredentialForm } from './_components/credential-form';

/**
 * auth-app landing (port 3002) — the sign-in surface. A credential form posting
 * to this app's server route handlers, which exchange the credentials with
 * auth-service and set the session cookies. Zitadel-hosted login can slot in
 * later behind the same route handlers.
 */
export default function Index() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md items-center px-s py-l">
      <Stack gap="l" className="w-full">
        <header>
          <Stack gap="2xs">
            <Overline>Identity</Overline>
            <HeadingOne>Sign in</HeadingOne>
            <Lead>Access the r10c marketplace fleet.</Lead>
          </Stack>
        </header>

        <Card>
          <CredentialForm mode="login" />
        </Card>

        <Text muted>
          No account?{' '}
          <Link href="/signup" className="underline">
            Create one
          </Link>
        </Text>
      </Stack>
    </main>
  );
}
