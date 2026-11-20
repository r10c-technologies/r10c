import { OrderItem, ProductOrder } from '@r10c/business-ts-order-management';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { OrderItemsCell, PRODUCT_ORDER_LIST_VIEW } from './order-list-cells.js';

const orderWith = (...names: string[]) =>
  Object.assign(new ProductOrder(), {
    items: names.map(name => new OrderItem('product-offering-1', name, 1)),
  });

describe('OrderItemsCell', () => {
  it('names a single product by the name it was sold under', () => {
    render(<OrderItemsCell order={orderWith('Lámpara Aurora')} />);

    expect(screen.getByText('Lámpara Aurora')).toBeInTheDocument();
  });

  it('names the first product and counts the rest', () => {
    render(
      <OrderItemsCell order={orderWith('Lámpara Aurora', 'Foco', 'Cable')} />,
    );

    expect(screen.getByText('Lámpara Aurora y 2 más')).toBeInTheDocument();
  });

  it('renders nothing for an order with no lines', () => {
    const { container } = render(<OrderItemsCell order={orderWith()} />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe('PRODUCT_ORDER_LIST_VIEW', () => {
  it('keeps the members a row is scanned by', () => {
    for (const member of [
      'number',
      'status',
      'items',
      'totalAmount',
      'placedAt',
      'paymentMethod',
    ])
      expect(PRODUCT_ORDER_LIST_VIEW.hiddenColumns).not.toContain(member);
  });
});
