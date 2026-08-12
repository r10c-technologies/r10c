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
import type { ConfigurationPlain } from '@r10c/entifix-ts-core';

import { useAsyncResource } from './use-async-resource';

/**
 * Where the provider's self-service lives, read from configuration.
 *
 * Through this app's `/api/config` route rather than an environment variable
 * baked into the bundle: the URL differs per environment and config-service is
 * the fleet's answer to that. It is not a secret — it is the address of a login
 * page — so it travels in the unredacted half of the response.
 */
const readAccountUrl = async (): Promise<string | undefined> => {
  const res = await fetch('/api/config', { cache: 'no-store' });
  if (!res.ok) throw new Error('config');
  const plain = (await res.json()) as ConfigurationPlain;
  const value = plain['zitadel']?.find(
    item => item.key === 'accountUrl',
  )?.value;
  // `ConfigurationPlain` types a value as `unknown` — a parameter may be a
  // number or a flag. This one is a URL or it is nothing.
  return typeof value === 'string' && value !== '' ? value : undefined;
};

/**
 * The account-security screen: an explanation and a link out.
 *
 * It looks thin, and that is the honest shape. r10c stores no password, holds
 * no TOTP secret and brokers no social account, so a screen here that offered
 * to change any of them would be a form posting to something that would have to
 * hold a credential — exactly what ADR 0016 removed.
 */
export function SecurityView() {
  const t = useT('shell');
  const accountUrl = useAsyncResource('account-url', readAccountUrl);

  return (
    <Stack gap="l">
      <header>
        <Stack gap="2xs">
          <Overline>{t('auth.security.overline')}</Overline>
          <HeadingOne>{t('auth.security.title')}</HeadingOne>
          <Lead>{t('auth.security.subtitle')}</Lead>
        </Stack>
      </header>

      <Card>
        <Stack gap="m">
          <Text muted>{t('auth.security.explain')}</Text>
          {/* Absent while loading, and absent for good if configuration could
              not be read — a dead link would be worse than none. */}
          {accountUrl.data === undefined ? null : (
            <ButtonLink
              href={accountUrl.data}
              target="_blank"
              rel="noreferrer noopener"
            >
              {t('auth.security.manage')}
            </ButtonLink>
          )}
        </Stack>
      </Card>
    </Stack>
  );
}
