import {
  ShipmentDestination,
  ShippingOrder,
} from '@r10c/business-ts-shipping-order-management';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BuyerChatRegion } from './buyer-chat-region.js';

const destination = Object.assign(new ShipmentDestination(), {
  name: 'Ana López',
  phone: '+50255551234',
});

const aShipment = (members: Partial<ShippingOrder> = {}) =>
  Object.assign(new ShippingOrder(), {
    id: 'so-1',
    orderNumber: '7KQ4-M2XD',
    status: 'awaiting-dispatch',
    destination: [destination],
    ...members,
  }) as ShippingOrder;

const hrefOf = () =>
  decodeURIComponent(
    screen.getByTestId('buyer-chat-link').getAttribute('href') ?? '',
  );

describe('BuyerChatRegion', () => {
  it('opens a chat on the buyer’s phone, prefilled for a parcel being prepared', () => {
    render(<BuyerChatRegion shipment={aShipment()} />);

    expect(hrefOf()).toMatch(/^https:\/\/wa\.me\/50255551234\?text=/);
    expect(hrefOf()).toContain('7KQ4-M2XD');
  });

  it('names the tracking number once the parcel left, and asks after it once delivered', () => {
    const { unmount } = render(
      <BuyerChatRegion
        shipment={aShipment({ status: 'dispatched', trackingNumber: 'G-1' })}
      />,
    );
    expect(hrefOf()).toContain('G-1');
    unmount();

    render(<BuyerChatRegion shipment={aShipment({ status: 'delivered' })} />);
    expect(hrefOf()).toContain('7KQ4-M2XD');
  });

  it('offers no chat once the address was removed', () => {
    const { container } = render(
      <BuyerChatRegion shipment={aShipment({ destination: [] })} />,
    );

    expect(container.textContent).toBe('');
  });

  it('opens with an empty tracking number when a dispatched parcel has none', () => {
    render(<BuyerChatRegion shipment={aShipment({ status: 'dispatched' })} />);
    expect(hrefOf()).toContain('7KQ4-M2XD');
  });
});
