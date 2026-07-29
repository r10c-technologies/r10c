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
  const t = useT('app');

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg items-center px-s py-l">
      <Stack gap="l" className="w-full">
        <header>
          <Stack gap="2xs">
            <Overline>{t('admin.account.title')}</Overline>
            <HeadingOne>{t('admin.account.signedIn')}</HeadingOne>
            <Lead>{t('admin.account.verified')}</Lead>
          </Stack>
        </header>

        <Card>
          <Stack gap="s">
            {principal === null ? (
              <Text muted>{t('admin.account.failed')}</Text>
            ) : (
              <Stack gap="2xs">
                <Text>
                  <strong>{t('admin.account.userId')}</strong>{' '}
                  {principal.userId}
                </Text>
                <Text>
                  <strong>{t('admin.account.subject')}</strong>{' '}
                  {principal.subject}
                </Text>
                <Text>
                  <strong>{t('admin.account.session')}</strong>{' '}
                  {principal.sessionId}
                </Text>
                <Text>
                  <strong>{t('admin.account.roles')}</strong>{' '}
                  {principal.roles.length > 0
                    ? principal.roles.join(', ')
                    : t('admin.account.none')}
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
