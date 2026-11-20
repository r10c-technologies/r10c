import type { Locale } from '@entifix/core';
import { getServerTFor } from '@entifix/i18n';
import { Stack, Text } from '@entifix/react-controls/primitives';

import {
  type ReceiptTracking,
  type TrackerStep,
  trackerSteps,
} from '../cart/receipt-state';

const MARK: Readonly<Record<TrackerStep['state'], string>> = {
  done: '✓',
  current: '●',
  todo: '○',
};

/**
 * Where one vendor order stands on its way to the door (ADR 0081 §11): an
 * ordered list of its steps, each saying whether it is done, under way or
 * still to come, and — once the parcel left — the courier, its tracking
 * number and the link to follow it. Server-rendered from the receipt read, so
 * a reload shows the truth with script off; a push only spares the reload.
 *
 * ⚠️ **A payment under way never reads as money taken**: a card order still
 * pending marks its payment step current, and cash on delivery has no payment
 * step at all — only a note that the buyer pays at the door.
 */
export function OrderTracker({
  locale,
  tracking,
}: {
  readonly locale: Locale;
  readonly tracking: ReceiptTracking;
}) {
  const t = getServerTFor(locale, 'r10c');
  const steps = trackerSteps(tracking.status, tracking.method);
  if (steps.length === 0) return null;
  const labelOf = (step: TrackerStep) =>
    step.key === 'payment'
      ? t(
          `storefront.order.tracker.payment.${tracking.method === 'link' ? 'link' : 'card'}`,
        )
      : t(`storefront.order.tracker.${step.key}`);

  return (
    <Stack gap="3xs" data-testid="order-tracker">
      <Text weight="semibold">{t('storefront.order.tracker.heading')}</Text>
      <ol
        className="flex flex-col gap-1"
        aria-label={t('storefront.order.tracker.heading')}
      >
        {steps.map(step => (
          <li
            key={step.key}
            data-testid={`tracker-${step.key}`}
            data-state={step.state}
            {...(step.state === 'current' ? { 'aria-current': 'step' } : {})}
          >
            <Text muted={step.state === 'todo'}>
              <span aria-hidden="true">{MARK[step.state]} </span>
              {labelOf(step)}
              <span className="sr-only">
                {' — '}
                {t(`storefront.order.tracker.state.${step.state}`)}
              </span>
            </Text>
          </li>
        ))}
      </ol>
      {tracking.method === 'cod' ? (
        <Text muted data-testid="tracker-cod-note">
          {t('storefront.order.tracker.codNote')}
        </Text>
      ) : null}
      {tracking.trackingNumber === undefined ? null : (
        <Text data-testid="tracker-guide">
          {t('storefront.order.tracker.guide', {
            courier: tracking.courierName ?? '',
            number: tracking.trackingNumber,
          })}
        </Text>
      )}
      {tracking.trackingUrl === undefined ? null : (
        <a
          href={tracking.trackingUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="touch-target underline"
          data-testid="tracker-follow"
        >
          {t('storefront.order.tracker.follow')}
        </a>
      )}
    </Stack>
  );
}
