import { ShippingOrder } from '@r10c/business-ts-shipping-order-management';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createClientAdapters } from './adapters/create-client-adapters.js';
import type { ShippingGuidePort } from './client-types.js';
import { FulfilmentProvider } from './fulfilment-context.js';
import { ShippingGuideRegion } from './shipping-guide-region.js';

const COURIERS = [
  { key: 'other', name: 'Other', trackingUrlTemplate: '' },
  {
    key: 'fast',
    name: 'Fast',
    trackingUrlTemplate: 'https://t.example/{guide}',
  },
];

const aShipment = (members: Partial<ShippingOrder> = {}) =>
  Object.assign(new ShippingOrder(), {
    id: 'so-1',
    status: 'awaiting-dispatch',
    ...members,
  }) as ShippingOrder;

const port = (
  overrides: Partial<ShippingGuidePort> = {},
): ShippingGuidePort => ({
  couriers: vi.fn(() => Promise.resolve(COURIERS)),
  record: vi.fn(() => Promise.resolve({ ok: true as const })),
  ...overrides,
});

const mount = (shipment: ShippingOrder, guide = port()) => {
  const onChanged = vi.fn();
  const view = render(
    <FulfilmentProvider adapters={{ ...createClientAdapters(), guide }}>
      <ShippingGuideRegion shipment={shipment} onChanged={onChanged} />
    </FulfilmentProvider>,
  );
  return { ...view, onChanged, guide };
};

describe('ShippingGuideRegion', () => {
  it('renders nothing for a parcel past dispatch that left with no guide', () => {
    const { container, guide } = mount(aShipment({ status: 'withdrawn' }));

    expect(container.textContent).toBe('');
    expect(guide.couriers).not.toHaveBeenCalled();
  });

  it('says a shipment awaiting dispatch has no guide, and records one from a listed courier', async () => {
    const { guide, onChanged } = mount(aShipment());
    expect(screen.getByTestId('shipping-guide-missing')).toBeTruthy();
    await screen.findByRole('option', { name: 'Fast' });

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'fast' },
    });
    expect(screen.queryByLabelText(/name|nombre/i)).toBeNull();
    fireEvent.change(
      screen.getByLabelText(/^(tracking number|número de guía)$/i),
      {
        target: { value: ' G-1 ' },
      },
    );
    fireEvent.submit(screen.getByTestId('shipping-guide-form'));

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledTimes(1);
    });
    expect(guide.record).toHaveBeenCalledWith('so-1', {
      courierKey: 'fast',
      trackingNumber: 'G-1',
    });
  });

  it('sends the vendor’s own courier name and page for `other`, and neither left blank', async () => {
    const { guide } = mount(aShipment());
    await screen.findByRole('option', { name: 'Other' });
    fireEvent.change(
      screen.getByLabelText(/^(tracking number|número de guía)$/i),
      {
        target: { value: 'G-2' },
      },
    );

    fireEvent.submit(screen.getByTestId('shipping-guide-form'));
    fireEvent.change(screen.getByLabelText(/courier name|nombre de la/i), {
      target: { value: 'Mensajería' },
    });
    fireEvent.change(screen.getByLabelText(/link|enlace/i), {
      target: { value: 'https://m.example/g' },
    });
    fireEvent.submit(screen.getByTestId('shipping-guide-form'));

    await waitFor(() => {
      expect(guide.record).toHaveBeenCalledTimes(2);
    });
    expect(guide.record).toHaveBeenNthCalledWith(1, 'so-1', {
      courierKey: 'other',
      trackingNumber: 'G-2',
    });
    expect(guide.record).toHaveBeenNthCalledWith(2, 'so-1', {
      courierKey: 'other',
      trackingNumber: 'G-2',
      courierName: 'Mensajería',
      trackingUrl: 'https://m.example/g',
    });
  });

  it('shows a refusal under its errors code, and stays', async () => {
    const { onChanged } = mount(
      aShipment(),
      port({
        record: vi.fn(() =>
          Promise.resolve({ ok: false as const, code: 'invalidGuide' }),
        ),
      }),
    );
    await screen.findByRole('option', { name: 'Other' });

    fireEvent.submit(screen.getByTestId('shipping-guide-form'));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('shows the guide a dispatched parcel left with, and the link to follow it, with no form', () => {
    mount(
      aShipment({
        status: 'dispatched',
        courierKey: 'fast',
        courierName: 'Fast',
        trackingNumber: 'G-1',
        trackingUrl: 'https://t.example/G-1',
      }),
    );

    expect(screen.getByTestId('shipping-guide-recorded').textContent).toContain(
      'G-1',
    );
    expect(screen.getByTestId('shipping-guide-link').getAttribute('href')).toBe(
      'https://t.example/G-1',
    );
    expect(screen.queryByTestId('shipping-guide-form')).toBeNull();
  });

  it('names an unnamed courier `other`, and prefills a recorded guide for relabelling', async () => {
    mount(aShipment({ courierKey: 'other', trackingNumber: 'G-7' }));
    await screen.findByRole('option', { name: 'Other' });

    expect(screen.getByTestId('shipping-guide-recorded').textContent).toContain(
      'other',
    );
    expect(
      (
        screen.getByLabelText(
          /^(tracking number|número de guía)$/i,
        ) as HTMLInputElement
      ).value,
    ).toBe('G-7');
  });

  it('drops a dictionary that arrives after the region left', async () => {
    let answer: (found: typeof COURIERS) => void = () => undefined;
    const couriers = vi.fn(
      () =>
        new Promise<typeof COURIERS>(resolve => {
          answer = resolve;
        }),
    );
    const { unmount } = mount(aShipment(), port({ couriers }));

    unmount();
    answer(COURIERS);
    await Promise.resolve();

    expect(couriers).toHaveBeenCalledTimes(1);
  });

  it('reloads the page by default once a guide lands', async () => {
    const reload = vi.fn();
    Object.defineProperty(globalThis, 'location', {
      value: { reload },
      configurable: true,
    });
    render(
      <FulfilmentProvider
        adapters={{ ...createClientAdapters(), guide: port() }}
      >
        <ShippingGuideRegion shipment={aShipment()} />
      </FulfilmentProvider>,
    );
    await screen.findByRole('option', { name: 'Other' });
    fireEvent.change(
      screen.getByLabelText(/^(tracking number|número de guía)$/i),
      {
        target: { value: 'G-1' },
      },
    );
    fireEvent.submit(screen.getByTestId('shipping-guide-form'));

    await waitFor(() => {
      expect(reload).toHaveBeenCalledTimes(1);
    });
  });
});
