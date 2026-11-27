import { describe, expect, it } from 'vitest';

import {
  PAYMENT_LINK_MAX_LENGTH,
  paymentLinkOf,
  paymentLinkProviderOf,
  paymentReferenceOf,
} from './payment-link.js';

const PROVIDERS = [
  { key: 'other', name: 'Other', hosts: [] },
  { key: 'acq', name: 'Acquirer', hosts: ['pay.acq.example'] },
];

describe('paymentLinkOf', () => {
  it('keeps an https link from a listed host, under its provider’s name', () => {
    expect(
      paymentLinkOf(
        { url: ' https://pay.acq.example/p/1 ', providerKey: 'acq' },
        PROVIDERS,
      ),
    ).toEqual({
      ok: true,
      value: {
        url: 'https://pay.acq.example/p/1',
        providerKey: 'acq',
        providerName: 'Acquirer',
      },
    });
  });

  it('takes the seller’s own name for `other`, or the dictionary’s', () => {
    const named = paymentLinkOf(
      {
        url: 'https://anywhere.example/x',
        providerKey: 'other',
        providerName: ' Mi banco ',
      },
      PROVIDERS,
    );
    const unnamed = paymentLinkOf(
      { url: 'https://anywhere.example/x', providerKey: 'other' },
      PROVIDERS,
    );

    expect(named).toMatchObject({ value: { providerName: 'Mi banco' } });
    expect(unnamed).toMatchObject({ value: { providerName: 'Other' } });
  });

  it.each([
    ['', 'other', 'url'],
    [
      `https://x.example/${'a'.repeat(PAYMENT_LINK_MAX_LENGTH)}`,
      'other',
      'url',
    ],
    ['http://x.example', 'other', 'url'],
    ['not a url', 'other', 'url'],
    ['https://x.example', 'nobody', 'providerKey'],
    ['https://x.example', 'acq', 'url'],
  ])('refuses %s from %s, naming %s', (url, providerKey, field) => {
    expect(paymentLinkOf({ url, providerKey }, PROVIDERS)).toMatchObject({
      ok: false,
      field,
    });
  });
});

describe('paymentReferenceOf', () => {
  it('keeps a trimmed authorization number and refuses a blank or long one', () => {
    expect(paymentReferenceOf({ reference: ' A-1 ' })).toEqual({
      ok: true,
      value: 'A-1',
    });
    expect(paymentReferenceOf({ reference: ' ' })).toMatchObject({
      ok: false,
      field: 'reference',
    });
    expect(paymentReferenceOf({ reference: 'x'.repeat(65) })).toMatchObject({
      ok: false,
    });
  });
});

describe('paymentLinkProviderOf', () => {
  it('reads a row’s JSON, lower-casing its hosts', () => {
    expect(
      paymentLinkProviderOf(
        'acq',
        '{"name":"Acquirer","hosts":["Pay.Acq.Example"]}',
      ),
    ).toEqual({ key: 'acq', name: 'Acquirer', hosts: ['pay.acq.example'] });
    expect(paymentLinkProviderOf('other', { name: 'Other' })).toEqual({
      key: 'other',
      name: 'Other',
      hosts: [],
    });
  });

  it.each([
    '{',
    'null',
    '{"name":" "}',
    '{"name":"A","hosts":"x"}',
    '{"name":"A","hosts":[1]}',
  ])('drops a row that is not a provider: %s', value => {
    expect(paymentLinkProviderOf('k', value)).toBeUndefined();
  });
});
