'use client';

import { Alert, Card, Stack, Text, useT } from '@entifix/react-controls';
import {
  Select,
  SubmitButton,
  TextInput,
} from '@entifix/react-controls/primitives';
import type { ShippingOrder } from '@r10c/business-ts-shipping-order-management';
import { type FormEvent, useEffect, useState } from 'react';

import type { CourierOption, GuideOutcome } from './client-types';
import { useFulfilmentAdapters } from './fulfilment-context';

/** The dictionary key a vendor picks when their courier is not listed. */
const OTHER = 'other';

/** A member a REST read hands back as a string, or nothing. */
const textOf = (value: unknown) =>
  typeof value === 'string' && value !== '' ? value : undefined;

const fieldOf = (form: HTMLFormElement, name: string) =>
  String(new FormData(form).get(name) ?? '').trim();

export interface ShippingGuideRegionProps {
  readonly shipment: ShippingOrder;
  /** What a write that landed does next; the page reloads by default. */
  readonly onChanged?: () => void;
}

/**
 * A shipment's guide on its record page (ADR 0081 §11): the courier and the
 * tracking number the parcel leaves with, recorded before it is dispatched —
 * a dispatch is refused until there is one. The verb carries a body, which the
 * generic verb buttons cannot send, so it is a form here; once the parcel
 * left, the guide it left with, and the link to follow it.
 */
export function ShippingGuideRegion({
  shipment,
  onChanged = () => {
    globalThis.location.reload();
  },
}: ShippingGuideRegionProps) {
  const t = useT('r10c');
  const tErrors = useT('errors');
  const { guide } = useFulfilmentAdapters();
  const [couriers, setCouriers] = useState<readonly CourierOption[]>([]);
  const [courier, setCourier] = useState(textOf(shipment.courierKey) ?? OTHER);
  const [refused, setRefused] = useState<string | undefined>();
  const open = shipment.status === 'awaiting-dispatch';

  useEffect(() => {
    if (!open) return;
    let live = true;
    void guide.couriers().then(found => {
      if (live) setCouriers(found);
    });
    return () => {
      live = false;
    };
  }, [open, guide]);

  const trackingNumber = textOf(shipment.trackingNumber);
  const trackingUrl = textOf(shipment.trackingUrl);
  // Only a parcel that is packed or on its way has a guide worth showing.
  if (!open && trackingNumber === undefined) return null;

  const settle = (outcome: GuideOutcome) => {
    if (outcome.ok) onChanged();
    else setRefused(outcome.code);
  };
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const name = fieldOf(form, 'courierName');
    const url = fieldOf(form, 'trackingUrl');
    void guide
      .record(String(shipment.id), {
        courierKey: courier,
        trackingNumber: fieldOf(form, 'trackingNumber'),
        ...(courier === OTHER && name !== '' ? { courierName: name } : {}),
        ...(courier === OTHER && url !== '' ? { trackingUrl: url } : {}),
      })
      .then(settle);
  };

  return (
    <Card>
      <Stack gap="s" data-testid="shipping-guide-region">
        <Text weight="semibold">{t('fulfilment.guide.heading')}</Text>
        {trackingNumber === undefined ? (
          <Text muted data-testid="shipping-guide-missing">
            {t('fulfilment.guide.missing')}
          </Text>
        ) : (
          <Text data-testid="shipping-guide-recorded">
            {t('fulfilment.guide.recorded', {
              courier: textOf(shipment.courierName) ?? OTHER,
              number: trackingNumber,
            })}
          </Text>
        )}
        {trackingUrl === undefined ? null : (
          <a
            href={trackingUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="text-step--1 underline"
            data-testid="shipping-guide-link"
          >
            {t('fulfilment.guide.follow')}
          </a>
        )}
        {refused === undefined ? null : (
          <Alert tone="danger">{tErrors(refused)}</Alert>
        )}
        {open ? (
          <form onSubmit={submit} data-testid="shipping-guide-form">
            <Stack gap="2xs">
              <label
                htmlFor="guide-courier"
                className="text-step--1 font-semibold"
              >
                {t('fulfilment.guide.courier')}
              </label>
              <Select
                id="guide-courier"
                name="courierKey"
                className="w-full min-w-0"
                value={courier}
                onChange={event => {
                  setCourier(event.currentTarget.value);
                }}
              >
                {couriers.map(option => (
                  <option key={option.key} value={option.key}>
                    {option.name}
                  </option>
                ))}
              </Select>
              {courier === OTHER ? (
                <>
                  <label
                    htmlFor="guide-courier-name"
                    className="text-step--1 font-semibold"
                  >
                    {t('fulfilment.guide.courierName')}
                  </label>
                  <TextInput
                    id="guide-courier-name"
                    name="courierName"
                    className="w-full min-w-0"
                    defaultValue={textOf(shipment.courierName) ?? ''}
                  />
                  <label
                    htmlFor="guide-tracking-url"
                    className="text-step--1 font-semibold"
                  >
                    {t('fulfilment.guide.trackingUrl')}
                  </label>
                  <TextInput
                    id="guide-tracking-url"
                    name="trackingUrl"
                    type="url"
                    className="w-full min-w-0"
                    defaultValue={trackingUrl ?? ''}
                  />
                </>
              ) : null}
              <label
                htmlFor="guide-number"
                className="text-step--1 font-semibold"
              >
                {t('fulfilment.guide.number')}
              </label>
              <TextInput
                id="guide-number"
                name="trackingNumber"
                required
                className="w-full min-w-0"
                defaultValue={trackingNumber ?? ''}
              />
              <SubmitButton className="touch-target">
                {t('fulfilment.guide.record')}
              </SubmitButton>
            </Stack>
          </form>
        ) : null}
      </Stack>
    </Card>
  );
}
