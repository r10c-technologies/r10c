import { ProductOrder } from '@r10c/business-ts-order-management';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createClientAdapters } from './adapters/create-client-adapters.js';
import type { PaymentLinkPort } from './client-types.js';
import { OrderProvider } from './order-context.js';
import { OrderPaymentRegion } from './order-payment-region.js';

const PROVIDERS = [
  { key: 'other', name: 'Other', hosts: [] },
  { key: 'acq', name: 'Acquirer', hosts: ['pay.acq.example'] },
];

const anOrder = (members: Partial<ProductOrder> = {}) =>
  Object.assign(new ProductOrder('party-1'), {
    id: 'ord-1',
    paymentMethod: 'link',
    status: 'awaiting-payment',
    paymentDueAt: '2026-11-21T10:00:00.000Z',
    ...members,
  }) as ProductOrder;

const port = (overrides: Partial<PaymentLinkPort> = {}): PaymentLinkPort => ({
  providers: vi.fn(() => Promise.resolve(PROVIDERS)),
  setLink: vi.fn(() => Promise.resolve({ ok: true as const })),
  confirm: vi.fn(() => Promise.resolve({ ok: true as const })),
  ...overrides,
});

const mount = (order: ProductOrder, paymentLink = port()) => {
  const onChanged = vi.fn();
  const view = render(
    <OrderProvider adapters={{ ...createClientAdapters(), paymentLink }}>
      <OrderPaymentRegion order={order} onChanged={onChanged} locale="en" />
    </OrderProvider>,
  );
  return { ...view, onChanged, paymentLink };
};

describe('OrderPaymentRegion', () => {
  it('renders nothing for an order paid any other way', () => {
    const { container } = mount(anOrder({ paymentMethod: 'card' }));

    expect(container.textContent).toBe('');
  });

  it('sets a link from a listed provider, and asks for no name', async () => {
    const { paymentLink, onChanged } = mount(anOrder());
    await screen.findByRole('option', { name: 'Acquirer' });

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'acq' },
    });
    expect(screen.queryByLabelText(/name|nombre/i)).toBeNull();
    fireEvent.change(screen.getByLabelText(/https/i), {
      target: { value: 'https://pay.acq.example/1' },
    });
    fireEvent.submit(screen.getByTestId('order-payment-link-form'));

    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledTimes(1);
    });
    expect(paymentLink.setLink).toHaveBeenCalledWith('ord-1', {
      url: 'https://pay.acq.example/1',
      providerKey: 'acq',
    });
  });

  it('sends the seller’s own provider name for `other`, and none left blank', async () => {
    const { paymentLink } = mount(anOrder());
    await screen.findByRole('option', { name: 'Other' });
    const url = screen.getByLabelText(/https/i);
    fireEvent.change(url, { target: { value: 'https://x.example/1' } });

    fireEvent.submit(screen.getByTestId('order-payment-link-form'));
    fireEvent.change(screen.getByLabelText(/name|nombre/i), {
      target: { value: ' Mi banco ' },
    });
    fireEvent.submit(screen.getByTestId('order-payment-link-form'));

    await waitFor(() => {
      expect(paymentLink.setLink).toHaveBeenCalledTimes(2);
    });
    expect(paymentLink.setLink).toHaveBeenNthCalledWith(1, 'ord-1', {
      url: 'https://x.example/1',
      providerKey: 'other',
    });
    expect(paymentLink.setLink).toHaveBeenNthCalledWith(2, 'ord-1', {
      url: 'https://x.example/1',
      providerKey: 'other',
      providerName: 'Mi banco',
    });
  });

  it('confirms with the authorization number, and shows a refusal', async () => {
    const paymentLink = port({
      confirm: vi.fn(() =>
        Promise.resolve({ ok: false as const, code: 'orderNotAwaitingPayment' }),
      ),
    });
    const { onChanged } = mount(anOrder(), paymentLink);

    fireEvent.change(screen.getByLabelText(/authori[sz]ation|autorizaci/i), {
      target: { value: 'AUTH-1' },
    });
    fireEvent.submit(screen.getByTestId('order-payment-confirm-form'));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(paymentLink.confirm).toHaveBeenCalledWith('ord-1', {
      reference: 'AUTH-1',
    });
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('shows a paid order’s confirmation and offers no form', () => {
    mount(
      anOrder({
        status: 'paid',
        paymentLinkUrl: 'https://x.example/1',
        paymentReference: 'AUTH-1',
        paymentConfirmedAt: '2026-11-20T10:00:00.000Z' as never,
        paymentDueAt: 'not a date' as never,
      }),
    );

    expect(screen.getByTestId('order-payment-reference').textContent).toMatch(
      /AUTH-1/,
    );
    expect(screen.getByTestId('order-payment-link')).toBeTruthy();
    expect(screen.queryByTestId('order-payment-link-form')).toBeNull();
    expect(screen.queryByTestId('order-payment-due')).toBeNull();
  });

  it('shows a confirmation whose stamp did not come back', () => {
    mount(anOrder({ status: 'paid', paymentReference: 'AUTH-2' }));

    expect(screen.getByTestId('order-payment-reference').textContent).toMatch(
      /AUTH-2/,
    );
  });

  it('reloads the page by default once a write landed', async () => {
    const reload = vi.fn();
    const original = globalThis.location;
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { ...original, reload },
    });
    try {
      render(
        <OrderProvider
          adapters={{ ...createClientAdapters(), paymentLink: port() }}
        >
          <OrderPaymentRegion order={anOrder()} />
        </OrderProvider>,
      );
      fireEvent.change(screen.getByLabelText(/authori[sz]ation|autorizaci/i), {
        target: { value: 'AUTH-1' },
      });
      fireEvent.submit(screen.getByTestId('order-payment-confirm-form'));

      await waitFor(() => {
        expect(reload).toHaveBeenCalledTimes(1);
      });
    } finally {
      Object.defineProperty(globalThis, 'location', {
        configurable: true,
        value: original,
      });
    }
  });

  it('stops listening to a dictionary read that lands after it unmounts', async () => {
    let resolve: (value: typeof PROVIDERS) => void = () => undefined;
    const paymentLink = port({
      providers: () =>
        new Promise(done => {
          resolve = done;
        }),
    });
    const { unmount } = mount(anOrder(), paymentLink);

    unmount();
    resolve(PROVIDERS);
    await Promise.resolve();

    expect(screen.queryByRole('option')).toBeNull();
  });
});
