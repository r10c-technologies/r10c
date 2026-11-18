import { describe, expect, it } from 'vitest';

import { CheckoutGroup } from '../entities/checkout-group/index.js';
import { ProductOrder } from '../entities/product-order/index.js';
import { CheckoutContact } from '../values/checkout-contact.js';
import { GroupTotal } from '../values/group-total.js';
import { OrderItem } from '../values/order-item.js';
import {
  composeAccessLinkMail,
  composeReceiptMail,
  fillMailTemplate,
} from './receipt-mail.js';

const LINK = 'http://localhost:3000/es/order/access?token=abc';

const contact = (extra: Partial<CheckoutContact> = {}) =>
  Object.assign(new CheckoutContact(), {
    name: 'Ana <López>',
    phone: '+50255551234',
    email: 'ana@correo.com',
    departamento: '01',
    municipio: '0108',
    addressLine: '5a avenida 12-34',
    ...extra,
  });

const aGroup = (extra: Partial<CheckoutGroup> = {}) =>
  Object.assign(new CheckoutGroup(), {
    id: 'g-1',
    number: '7KQ4-M2XD',
    totals: [new GroupTotal(4500, 'GTQ')],
    contact: [contact({ zona: 10, reference: 'portón negro' })],
    ...extra,
  });

const anOrder = (
  number: string,
  paymentMethod: ProductOrder['paymentMethod'],
  items = [new OrderItem('o-1', 'Lámpara Aurora', 2, 4000, 'GTQ')],
) =>
  Object.assign(new ProductOrder('buyer-1'), {
    number,
    paymentMethod,
    items,
  });

describe('composeReceiptMail', () => {
  it('writes the receipt to the contact, in Spanish by default, with the link', () => {
    const mail = composeReceiptMail({
      group: aGroup(),
      orders: [
        anOrder('AAAA-1111', 'card'),
        anOrder('BBBB-2222', 'cod', [
          new OrderItem('o-2', 'Foco', 1, 500, 'GTQ'),
        ]),
      ],
      link: LINK,
      linkHours: 24,
    });

    expect(mail?.to).toBe('ana@correo.com');
    expect(mail?.subject).toBe('Tu pedido 7KQ4-M2XD');
    expect(mail?.text).toContain('Pedido AAAA-1111 · Tarjeta');
    expect(mail?.text).toContain('Pedido BBBB-2222 · Contra entrega');
    expect(mail?.text).toMatch(/2 × Lámpara Aurora — Q\s40\.00/);
    expect(mail?.text).toMatch(/Total: Q\s45\.00/);
    expect(mail?.text).toContain('Zona 10, ');
    expect(mail?.text).toContain('portón negro');
    expect(mail?.text).toContain('Guatemala');
    expect(mail?.text).toContain('vence en 24 horas');
    expect(mail?.text).toContain(`Abrir mi pedido: ${LINK}`);
    expect(mail?.html).toContain('Ana &lt;López&gt;');
    expect(mail?.html).not.toContain('<López>');
    expect(mail?.html).toContain(`<a href="${LINK}">Abrir mi pedido</a>`);
  });

  it('writes English for an English checkout, and copes with what is missing', () => {
    const mail = composeReceiptMail({
      group: aGroup({
        locale: 'en',
        contact: [contact({ municipio: '9999', departamento: '99' })],
      }),
      orders: [anOrder('CCCC-3333', 'cash', [])],
      link: LINK,
      linkHours: 2,
    });

    expect(mail?.subject).toBe('Your order 7KQ4-M2XD');
    expect(mail?.text).toContain('Order CCCC-3333 · Cash');
    expect(mail?.text).toMatch(/Total for this order: Q\s0\.00/);
    expect(mail?.text).toContain('9999, 99');
    expect(mail?.text).not.toContain('Zona');
  });

  it('writes nothing for a group with no contact', () => {
    expect(
      composeReceiptMail({
        group: aGroup({ contact: [] }),
        orders: [],
        link: LINK,
        linkHours: 24,
      }),
    ).toBeUndefined();
  });
});

describe('composeAccessLinkMail', () => {
  it('sends only the link, to the email on file', () => {
    const mail = composeAccessLinkMail({
      group: aGroup(),
      link: LINK,
      linkHours: 24,
    });

    expect(mail?.to).toBe('ana@correo.com');
    expect(mail?.subject).toBe('Tu enlace para ver el pedido 7KQ4-M2XD');
    expect(mail?.text).toContain('nadie más recibió el enlace');
    expect(mail?.text).not.toContain('Lámpara');
  });

  it('writes nothing for a group with no contact', () => {
    expect(
      composeAccessLinkMail({
        group: aGroup({ contact: [] }),
        link: LINK,
        linkHours: 24,
      }),
    ).toBeUndefined();
  });
});

describe('fillMailTemplate', () => {
  it('fills what it knows and leaves the rest', () => {
    expect(fillMailTemplate('{{a}} and {{b}}', { a: 1 })).toBe('1 and {{b}}');
  });
});
