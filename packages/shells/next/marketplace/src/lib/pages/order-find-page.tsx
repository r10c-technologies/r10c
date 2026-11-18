import type { Locale } from '@entifix/core';
import { getServerTFor } from '@entifix/i18n';
import {
  Alert,
  Card,
  HeadingOne,
  Stack,
  SubmitButton,
  Text,
  TextInput,
} from '@entifix/react-controls/primitives';

import { findOrder } from '../cart/find-action';
import { StoreShell } from './store-shell';

/**
 * "Find my order" (ADR 0076 §6): a plain form, so it works with scripting off,
 * that asks order-service to mail a fresh access link to the email on file.
 * After a post it says the same thing whatever matched.
 */
export function OrderFindPage({
  locale,
  sent,
}: {
  readonly locale: Locale;
  readonly sent?: boolean;
}) {
  const t = getServerTFor(locale, 'r10c');

  return (
    <StoreShell locale={locale}>
      <Stack gap="l">
        <HeadingOne>{t('storefront.order.find.heading')}</HeadingOne>
        {sent === true ? (
          <Alert tone="info" data-testid="find-sent">
            {t('storefront.order.find.sent')}
          </Alert>
        ) : undefined}
        <Card>
          <form action={findOrder} data-testid="find-form">
            <Stack gap="s">
              <Text>{t('storefront.order.find.intro')}</Text>
              <input type="hidden" name="locale" value={locale} />
              <div className="flex min-w-0 flex-col gap-3xs">
                <label
                  htmlFor="find-number"
                  className="text-step--1 font-semibold"
                >
                  {t('storefront.order.find.number')}
                </label>
                <TextInput
                  id="find-number"
                  name="number"
                  className="w-full min-w-0"
                  autoComplete="off"
                  required
                />
              </div>
              <div className="flex min-w-0 flex-col gap-3xs">
                <label
                  htmlFor="find-email"
                  className="text-step--1 font-semibold"
                >
                  {t('storefront.order.find.email')}
                </label>
                <TextInput
                  id="find-email"
                  name="email"
                  type="email"
                  className="w-full min-w-0"
                  autoComplete="email"
                  required
                />
              </div>
              <div>
                <SubmitButton>{t('storefront.order.find.submit')}</SubmitButton>
              </div>
            </Stack>
          </form>
        </Card>
      </Stack>
    </StoreShell>
  );
}
