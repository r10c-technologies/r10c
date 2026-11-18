import { type Locale, localeHref } from '@entifix/core';
import { getServerTFor } from '@entifix/i18n';
import {
  ButtonLink,
  Card,
  EmptyState,
  HeadingOne,
  Stack,
  SubmitButton,
  Text,
} from '@entifix/react-controls/primitives';

import { redeemAccessLink } from '../cart/access-action';
import { storePaths } from '../routing/paths';
import { StoreShell } from './store-shell';

/**
 * Where a mailed one-time access link lands (ADR 0076 §6).
 *
 * ⚠️ **Opening the page spends nothing.** The token rides the query string
 * into a hidden field, and only the button's post redeems it — so a mail
 * scanner that pre-fetches every link cannot use one up before the buyer does.
 * The route answers with `Referrer-Policy: strict-origin`, so the token never
 * leaves in a `Referer` either — and its post still carries the `Origin` Next's
 * CSRF check reads, which `no-referrer` would send as `null` (#725).
 */
export function OrderAccessPage({
  locale,
  token,
  failed,
}: {
  readonly locale: Locale;
  readonly token?: string;
  readonly failed?: boolean;
}) {
  const t = getServerTFor(locale, 'r10c');
  const findOrder = (
    <ButtonLink href={localeHref(locale, storePaths.orderFind())}>
      {t('storefront.order.findLink')}
    </ButtonLink>
  );

  return (
    <StoreShell locale={locale}>
      <Stack gap="l">
        <HeadingOne>{t('storefront.order.access.heading')}</HeadingOne>
        {failed === true || token === undefined || token === '' ? (
          <EmptyState data-testid="access-refused" action={findOrder}>
            {failed === true
              ? t('storefront.order.access.failed')
              : t('storefront.order.access.missing')}
          </EmptyState>
        ) : (
          <Card>
            <form action={redeemAccessLink} data-testid="access-form">
              <Stack gap="s">
                <Text>{t('storefront.order.access.intro')}</Text>
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="token" value={token} />
                <div>
                  <SubmitButton>
                    {t('storefront.order.access.open')}
                  </SubmitButton>
                </div>
              </Stack>
            </form>
          </Card>
        )}
      </Stack>
    </StoreShell>
  );
}
