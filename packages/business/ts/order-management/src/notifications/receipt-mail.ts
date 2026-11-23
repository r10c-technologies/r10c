// order-service loads no catalog shell, so the declaration is loaded here:
// without it `es` would be written as Spain writes it.
import '@r10c/business-ts-i18n/locales';

import { formattingLocale } from '@entifix/core';
import { r10cCatalogs } from '@r10c/business-ts-i18n';
import { departamentoOf, municipioOf } from '@r10c/business-ts-order-contracts';
import { formatQuantity } from '@r10c/business-ts-sales-vocabulary';

import type { CheckoutGroup } from '../entities/checkout-group';
import type { ProductOrder } from '../entities/product-order';
import type { BuyerMail } from '../ports/buyer-notifier';

type MailCopy = (typeof r10cCatalogs)['es']['r10c']['mail'];

/** The copy for a group's locale; Spanish, the default, for anything else. */
const copyFor = (locale: string | undefined): MailCopy =>
  (locale === 'en' ? r10cCatalogs.en : r10cCatalogs.es).r10c.mail;

/**
 * How money is written: the buyer's language, Guatemala's conventions — so a
 * quetzal reads `Q45.00` in either, as the storefront writes it.
 */
const localeOf = (locale: string | undefined) =>
  formattingLocale(locale === 'en' ? 'en' : 'es');

/** `{{name}}` placeholders, filled from `values`; an unknown one stays put. */
export const fillMailTemplate = (
  template: string,
  values: Readonly<Record<string, string | number>>,
): string =>
  template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) =>
    key in values ? String(values[key]) : whole,
  );

const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** An amount in minor units, as the buyer's locale writes that currency. */
const money = (locale: string, amount: number, currency: string): string => {
  const format = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
  });
  // Always set for a currency format: GTQ answers 2, a zero-decimal one 0.
  const digits = format.resolvedOptions().maximumFractionDigits as number;
  return format.format(amount / 10 ** digits);
};

/**
 * How much of a line was sold, as the buyer's locale writes it, with its
 * unit's symbol: `3.5 m`, `2 u.` (ADR 0082 §2). The order write refuses a line
 * with no unit, so a placed one always has it; the bare number is only the
 * member's type's other case, never a unit guessed for it.
 */
const soldQuantity = (
  language: string | undefined,
  item: ProductOrder['items'][number],
): string => {
  if (item.saleUnit === undefined) return String(item.quantity);
  const catalog = language === 'en' ? r10cCatalogs.en : r10cCatalogs.es;
  return `${formatQuantity(item.quantity, item.saleUnit, language === 'en' ? 'en' : 'es')} ${catalog.entity['sale-unit'].symbol[item.saleUnit]}`;
};

/** One paragraph per entry: text joined by blank lines, HTML as `<p>`s. */
const render = (
  paragraphs: readonly (readonly string[])[],
  link: { readonly href: string; readonly label: string },
) => ({
  text: [
    ...paragraphs.map(lines => lines.join('\n')),
    `${link.label}: ${link.href}`,
  ].join('\n\n'),
  html: [
    ...paragraphs.map(lines => `<p>${lines.map(escapeHtml).join('<br>')}</p>`),
    `<p><a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></p>`,
  ].join('\n'),
});

/**
 * The receipt mail a storefront checkout ends with (ADR 0076 §6): the group's
 * number, each seller's number, lines, tender and total, the basket's totals,
 * where it goes, and a one-time access link — in the locale the buyer checked
 * out in. `undefined` for a group with no contact to write to: a counter sale,
 * or one whose contact was already removed.
 */
export const composeReceiptMail = (input: {
  readonly group: CheckoutGroup;
  readonly orders: readonly ProductOrder[];
  readonly link: string;
  readonly linkHours: number;
}): BuyerMail | undefined => {
  const { group, orders, link, linkHours } = input;
  const contact = group.contact[0];
  if (contact === undefined) return undefined;
  const copy = copyFor(group.locale);
  const locale = localeOf(group.locale);

  const sellerOrders = orders.map(order => {
    const currency = order.items[0]?.currency ?? 'GTQ';
    return [
      fillMailTemplate(copy.receipt.sellerOrder, {
        number: order.number,
        tender: copy.tender[order.paymentMethod],
      }),
      ...order.items.map(item =>
        fillMailTemplate(copy.receipt.line, {
          quantity: soldQuantity(group.locale, item),
          name: item.name,
          // What the line cost, as placed: never the unit price, which for a
          // measured line or one priced per hundred is not what was paid.
          amount: money(locale, item.lineTotal, item.currency),
        }),
      ),
      fillMailTemplate(copy.receipt.orderTotal, {
        // The document's stored total, never re-derived: a line's `amount` is
        // a unit price, so summing it says Q40 for two at Q40.
        amount: money(locale, order.totalAmount, currency),
      }),
      // A pequeño contribuyente's document shows no IVA (ADR 0078 §6): its
      // tax is on the gross, not broken out of the price.
      ...(order.sellerTaxRegime === 'small-taxpayer'
        ? []
        : [
            fillMailTemplate(copy.receipt.ivaIncluded, {
              amount: money(locale, order.taxAmount, currency),
            }),
          ]),
    ];
  });
  const buyer = orders[0];
  const billedTo =
    buyer === undefined || buyer.buyerTaxIdType === 'cf'
      ? copy.receipt.billedToCf
      : fillMailTemplate(copy.receipt.billedTo, {
          name: buyer.buyerTaxName,
          idType: buyer.buyerTaxIdType.toUpperCase(),
          taxId: buyer.buyerTaxId,
        });
  const totals = group.totals.map(total =>
    fillMailTemplate(copy.receipt.total, {
      amount: money(locale, total.amount, total.currency),
    }),
  );
  const place = [
    contact.addressLine,
    ...(contact.reference === undefined ? [] : [contact.reference]),
    [
      ...(contact.zona === undefined ? [] : [`Zona ${String(contact.zona)}`]),
      municipioOf(contact.municipio)?.name ?? contact.municipio,
      departamentoOf(contact.departamento)?.name ?? contact.departamento,
    ].join(', '),
  ];

  const body = render(
    [
      [fillMailTemplate(copy.receipt.greeting, { name: contact.name })],
      [fillMailTemplate(copy.receipt.intro, { number: group.number })],
      ...sellerOrders,
      totals,
      [billedTo],
      [copy.receipt.deliveryHeading, contact.name, ...place],
      [fillMailTemplate(copy.access.link, { hours: linkHours })],
    ],
    { href: link, label: copy.access.action },
  );
  return {
    to: contact.email,
    subject: fillMailTemplate(copy.receipt.subject, { number: group.number }),
    ...body,
  };
};

/**
 * The mail a lookup sends (ADR 0076 §6): a fresh access link and nothing
 * else, to the email on file — never to an address the asker typed.
 * `undefined` for a group with no contact.
 */
export const composeAccessLinkMail = (input: {
  readonly group: CheckoutGroup;
  readonly link: string;
  readonly linkHours: number;
}): BuyerMail | undefined => {
  const { group, link, linkHours } = input;
  const contact = group.contact[0];
  if (contact === undefined) return undefined;
  const copy = copyFor(group.locale);

  const body = render(
    [
      [fillMailTemplate(copy.receipt.greeting, { name: contact.name })],
      [fillMailTemplate(copy.access.intro, { number: group.number })],
      [fillMailTemplate(copy.access.link, { hours: linkHours })],
      [copy.access.notYou],
    ],
    { href: link, label: copy.access.action },
  );
  return {
    to: contact.email,
    subject: fillMailTemplate(copy.access.subject, { number: group.number }),
    ...body,
  };
};
