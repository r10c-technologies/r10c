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

import type { Principal } from '../../../lib/principal';

/**
 * Client renderer for the account profile. The layout above already resolved
 * and verified the principal against auth-service, so this only presents it —
 * no design-system control is imported into the server tree.
 */
export function AccountView({ principal }: { principal: Principal | null }) {
  const t = useT('app');

  if (principal === null) {
    return (
      <Card>
        <Text muted>{t('auth.account.failed')}</Text>
      </Card>
    );
  }

  return (
    <Stack gap="l">
      <header>
        <Stack gap="2xs">
          <Overline>{t('auth.account.overline')}</Overline>
          <HeadingOne>{t('auth.account.title')}</HeadingOne>
          <Lead>{t('auth.account.subtitle')}</Lead>
        </Stack>
      </header>

      <Card>
        <Stack gap="2xs">
          <Text>
            <strong>{t('auth.account.userId')}</strong> {principal.userId}
          </Text>
          <Text>
            <strong>{t('auth.account.subject')}</strong> {principal.subject}
          </Text>
          <Text>
            <strong>{t('auth.account.session')}</strong> {principal.sessionId}
          </Text>
          <Text>
            <strong>{t('auth.account.roles')}</strong>{' '}
            {principal.roles.length > 0
              ? principal.roles.join(', ')
              : t('auth.account.none')}
          </Text>
        </Stack>
      </Card>
    </Stack>
  );
}
