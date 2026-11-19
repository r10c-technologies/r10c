'use client';

import { Alert, Card, Stack, Text, useT } from '@entifix/react-controls';
import {
  Select,
  SubmitButton,
  TextInput,
} from '@entifix/react-controls/primitives';
import type { ProductOrder } from '@r10c/business-ts-order-management';
import { type FormEvent, useEffect, useState } from 'react';

import type {
  PaymentLinkOutcome,
  PaymentLinkProviderOption,
} from './client-types';
import { useOrderAdapters } from './order-context';

/** The dictionary key a seller picks when their provider is not listed. */
const OTHER = 'other';

/** A member a REST read hands back as a string, or nothing. */
const textOf = (value: unknown) =>
  typeof value === 'string' && value !== '' ? value : undefined;

/** A stamp a REST read hands back as an ISO string, formatted, or nothing. */
const formatted = (value: unknown, locale: string) => {
  if (value === undefined || value === null) return undefined;
  const at = new Date(value as string);
  return Number.isNaN(at.getTime())
    ? undefined
    : new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(at);
};

const fieldOf = (form: HTMLFormElement, name: string) =>
  String(new FormData(form).get(name) ?? '');

export interface OrderPaymentRegionProps {
  readonly order: ProductOrder;
  /** What a write that landed does next; the page reloads by default. */
  readonly onChanged?: () => void;
  readonly locale?: string;
}

/**
 * A payment-link order's region on its record page (ADR 0081): while it waits,
 * the seller pastes the link the buyer pays by and confirms the payment with
 * its authorization number; once paid, who confirmed it and with what. Both
 * verbs carry a body, which the generic verb buttons cannot send, so they are
 * a form here — and each is still one conditional write on the order, refused
 * with the reason when an expiry or the buyer got there first.
 */
export function OrderPaymentRegion({
  order,
  onChanged = () => {
    globalThis.location.reload();
  },
  locale = 'es',
}: OrderPaymentRegionProps) {
  const t = useT('r10c');
  const tErrors = useT('errors');
  const { paymentLink } = useOrderAdapters();
  const [providers, setProviders] = useState<
    readonly PaymentLinkProviderOption[]
  >([]);
  const [provider, setProvider] = useState(OTHER);
  const [refused, setRefused] = useState<string | undefined>();
  const awaiting = order.status === 'awaiting-payment';

  useEffect(() => {
    if (!awaiting || order.paymentMethod !== 'link') return;
    let live = true;
    void paymentLink.providers().then(found => {
      if (live) setProviders(found);
    });
    return () => {
      live = false;
    };
  }, [awaiting, order.paymentMethod, paymentLink]);

  if (order.paymentMethod !== 'link') return null;

  const orderId = String(order.id);
  const settle = (outcome: PaymentLinkOutcome) => {
    if (outcome.ok) onChanged();
    else setRefused(outcome.code);
  };
  const submitLink = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const name = fieldOf(form, 'providerName').trim();
    void paymentLink
      .setLink(orderId, {
        url: fieldOf(form, 'url'),
        providerKey: provider,
        ...(provider === OTHER && name !== '' ? { providerName: name } : {}),
      })
      .then(settle);
  };
  const submitConfirmation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void paymentLink
      .confirm(orderId, { reference: fieldOf(event.currentTarget, 'reference') })
      .then(settle);
  };

  const due = formatted(order.paymentDueAt, locale);
  const linkUrl = textOf(order.paymentLinkUrl);
  const reference = textOf(order.paymentReference);
  const confirmedAt = formatted(order.paymentConfirmedAt, locale);

  return (
    <Card>
      <Stack gap="s" data-testid="order-payment-region">
        <Text weight="semibold">{t('order.payment.heading')}</Text>
        {awaiting && due !== undefined ? (
          <Text data-testid="order-payment-due">
            {t('order.payment.due', { time: due })}
          </Text>
        ) : null}
        {linkUrl === undefined ? null : (
          <Text muted data-testid="order-payment-link">
            {t('order.payment.linkSet', {
              provider: textOf(order.paymentLinkProviderName) ?? OTHER,
              url: linkUrl,
            })}
          </Text>
        )}
        {reference === undefined ? null : (
          <Text data-testid="order-payment-reference">
            {t('order.payment.confirmed', {
              reference,
              time: confirmedAt ?? '',
            })}
          </Text>
        )}
        {refused === undefined ? null : (
          <Alert tone="danger">{tErrors(refused)}</Alert>
        )}
        {awaiting ? (
          <>
            <form onSubmit={submitLink} data-testid="order-payment-link-form">
              <Stack gap="2xs">
                <label
                  htmlFor="payment-provider"
                  className="text-step--1 font-semibold"
                >
                  {t('order.payment.provider')}
                </label>
                <Select
                  id="payment-provider"
                  name="providerKey"
                  className="w-full min-w-0"
                  value={provider}
                  onChange={event => {
                    setProvider(event.currentTarget.value);
                  }}
                >
                  {providers.map(option => (
                    <option key={option.key} value={option.key}>
                      {option.name}
                    </option>
                  ))}
                </Select>
                {provider === OTHER ? (
                  <>
                    <label
                      htmlFor="payment-provider-name"
                      className="text-step--1 font-semibold"
                    >
                      {t('order.payment.providerName')}
                    </label>
                    <TextInput
                      id="payment-provider-name"
                      name="providerName"
                      className="w-full min-w-0"
                    />
                  </>
                ) : null}
                <label
                  htmlFor="payment-url"
                  className="text-step--1 font-semibold"
                >
                  {t('order.payment.url')}
                </label>
                <TextInput
                  id="payment-url"
                  name="url"
                  type="url"
                  required
                  className="w-full min-w-0"
                  defaultValue={linkUrl ?? ''}
                />
                <SubmitButton className="touch-target">
                  {t('order.payment.setLink')}
                </SubmitButton>
              </Stack>
            </form>
            <form
              onSubmit={submitConfirmation}
              data-testid="order-payment-confirm-form"
            >
              <Stack gap="2xs">
                <label
                  htmlFor="payment-reference"
                  className="text-step--1 font-semibold"
                >
                  {t('order.payment.reference')}
                </label>
                <TextInput
                  id="payment-reference"
                  name="reference"
                  required
                  className="w-full min-w-0"
                />
                <SubmitButton className="touch-target">
                  {t('order.payment.confirm')}
                </SubmitButton>
              </Stack>
            </form>
          </>
        ) : null}
      </Stack>
    </Card>
  );
}
