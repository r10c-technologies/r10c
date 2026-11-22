import {
  ShipmentDestination,
  ShippingLine,
  ShippingOrder,
} from '@r10c/business-ts-shipping-order-management';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  AmountDueCell,
  ShipmentContentsCell,
  ShipmentDestinationCell,
  SHIPPING_ORDER_LIST_VIEW,
} from './shipment-list-cells.js';

const shipmentWith = (fields: Partial<ShippingOrder>) =>
  Object.assign(new ShippingOrder(), fields);

describe('ShipmentContentsCell', () => {
  it('says what goes in the parcel, line by line', () => {
    render(
      <ShipmentContentsCell
        shipment={shipmentWith({
          lines: [
            new ShippingLine('product-offering-1', 'Engranaje', 2),
            new ShippingLine('product-offering-2', 'Brida', 1),
          ],
        })}
      />,
    );

    expect(screen.getByText('2 × Engranaje, 1 × Brida')).toBeInTheDocument();
  });
});

describe('ShipmentDestinationCell', () => {
  it('names the municipality and the department from their codes', () => {
    render(
      <ShipmentDestinationCell
        shipment={shipmentWith({
          destination: [
            Object.assign(new ShipmentDestination(), {
              municipio: '0108',
              departamento: '01',
            }),
          ],
        })}
      />,
    );

    expect(screen.getByText('Mixco, Guatemala')).toBeInTheDocument();
  });

  it('leaves out a code it does not know', () => {
    render(
      <ShipmentDestinationCell
        shipment={shipmentWith({
          destination: [
            Object.assign(new ShipmentDestination(), {
              municipio: '9999',
              departamento: '17',
            }),
          ],
        })}
      />,
    );

    expect(screen.getByText('Petén')).toBeInTheDocument();
  });

  it('renders nothing once the destination was removed', () => {
    const { container } = render(
      <ShipmentDestinationCell shipment={shipmentWith({ destination: [] })} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});

describe('AmountDueCell', () => {
  it('reads what the courier collects as money', () => {
    render(
      <AmountDueCell
        shipment={shipmentWith({
          paymentMethod: 'cod',
          amountDue: 12_500,
          currency: 'GTQ',
        })}
      />,
    );

    expect(screen.getByText(/Q\s125\.00/)).toBeInTheDocument();
  });

  it('shows nothing on a parcel nobody collects for', () => {
    const { container } = render(
      <AmountDueCell
        shipment={shipmentWith({
          paymentMethod: 'card',
          amountDue: 12_500,
          currency: 'GTQ',
        })}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});

describe('SHIPPING_ORDER_LIST_VIEW', () => {
  it('keeps the members a packer reads a row by', () => {
    for (const member of [
      'orderNumber',
      'status',
      'lines',
      'destination',
      'paymentMethod',
      'amountDue',
    ])
      expect(SHIPPING_ORDER_LIST_VIEW.hiddenColumns).not.toContain(member);
  });
});
