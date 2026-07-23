'use client';

import {
  Card,
  HeadingOne,
  Lead,
  Overline,
  Stack,
  Text,
} from '@r10c/entifix-react-controls';

import { LogoutButton } from './logout-button';

export interface Principal {
  userId: string;
  subject: string;
  sessionId: string;
  roles: string[];
}

/**
 * Client renderer for the account page. The server component does the
 * token-verified fetch and hands the result down as a prop, so the design-system
 * controls (client components) are never imported into the server tree.
 */
export function AccountView({ principal }: { principal: Principal | null }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg items-center px-s py-l">
      <Stack gap="l" className="w-full">
        <header>
          <Stack gap="2xs">
            <Overline>Account</Overline>
            <HeadingOne>Signed in</HeadingOne>
            <Lead>Identity verified by marketplace-admin-service.</Lead>
          </Stack>
        </header>

        <Card>
          <Stack gap="s">
            {principal === null ? (
              <Text muted>
                Could not verify your session with the backend. Try signing in
                again.
              </Text>
            ) : (
              <Stack gap="2xs">
                <Text>
                  <strong>User id:</strong> {principal.userId}
                </Text>
                <Text>
                  <strong>Subject:</strong> {principal.subject}
                </Text>
                <Text>
                  <strong>Session:</strong> {principal.sessionId}
                </Text>
                <Text>
                  <strong>Roles:</strong>{' '}
                  {principal.roles.length > 0
                    ? principal.roles.join(', ')
                    : '(none)'}
                </Text>
              </Stack>
            )}
            <LogoutButton />
          </Stack>
        </Card>
      </Stack>
    </main>
  );
}
