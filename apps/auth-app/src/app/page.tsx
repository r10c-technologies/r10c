'use client';

import {
  Button,
  Card,
  HeadingOne,
  Lead,
  Overline,
  Stack,
  Text,
  ThemeSwitcher,
} from '@r10c/entifix-react-controls';

/**
 * auth-app landing (port 3002) — Foundation shell.
 *
 * A placeholder sign-in surface. The Zitadel-hosted login + session exchange
 * with auth-service (3102) is wired in the next iteration; for now this proves
 * the app boots, shares the entifix design system, and resolves its backend
 * URL through config-service.
 */
export default function Index() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md items-center px-s py-l">
      <Stack gap="l" className="w-full">
        <header className="flex items-start justify-between gap-s">
          <Stack gap="2xs" className="min-w-0">
            <Overline>Identity</Overline>
            <HeadingOne>Sign in</HeadingOne>
            <Lead>Access the r10c marketplace fleet.</Lead>
          </Stack>
          <ThemeSwitcher className="shrink-0" />
        </header>

        <Card>
          <Stack gap="s">
            <Text muted>
              Login is handled by Zitadel (wired next iteration). This shell
              resolves auth-service through config-service.
            </Text>
            <Button variant="primary" size="lg" disabled>
              Continue with Zitadel
            </Button>
          </Stack>
        </Card>
      </Stack>
    </main>
  );
}
