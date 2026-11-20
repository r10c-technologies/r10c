import { describe, expect, it } from 'vitest';

import { type Courier, courierOf, guideOf, OTHER_COURIER } from './courier.js';

const FAST: Courier = {
  key: 'fast',
  name: 'Fast',
  trackingUrlTemplate: 'https://track.example/t/{guide}',
};
const PLAIN: Courier = { key: 'plain', name: 'Plain', trackingUrlTemplate: '' };
const OTHER: Courier = {
  key: OTHER_COURIER,
  name: 'Other',
  trackingUrlTemplate: '',
};
const COURIERS = [FAST, PLAIN, OTHER];

describe('guideOf', () => {
  it('renders the tracking URL from the courier’s template, the number encoded', () => {
    expect(
      guideOf({ courierKey: 'fast', trackingNumber: ' AB 12/3 ' }, COURIERS),
    ).toEqual({
      ok: true,
      value: {
        courierKey: 'fast',
        courierName: 'Fast',
        trackingNumber: 'AB 12/3',
        trackingUrl: 'https://track.example/t/AB%2012%2F3',
      },
    });
  });

  it('leaves the URL empty for a listed courier with no tracking page', () => {
    expect(
      guideOf({ courierKey: 'plain', trackingNumber: 'G-1' }, COURIERS),
    ).toMatchObject({ ok: true, value: { trackingUrl: '' } });
  });

  it('takes the seller’s own name and https page for `other`', () => {
    expect(
      guideOf(
        {
          courierKey: 'other',
          trackingNumber: 'G-1',
          courierName: '  Mensajería del barrio  ',
          trackingUrl: 'https://barrio.example/g/1',
        },
        COURIERS,
      ),
    ).toEqual({
      ok: true,
      value: {
        courierKey: 'other',
        courierName: 'Mensajería del barrio',
        trackingNumber: 'G-1',
        trackingUrl: 'https://barrio.example/g/1',
      },
    });
  });

  it('falls back to the dictionary’s name and no page when `other` names neither', () => {
    expect(
      guideOf(
        {
          courierKey: 'other',
          trackingNumber: 'G-1',
          courierName: ' ',
          trackingUrl: ' ',
        },
        COURIERS,
      ),
    ).toMatchObject({
      ok: true,
      value: { courierName: 'Other', trackingUrl: '' },
    });
    expect(
      guideOf({ courierKey: 'other', trackingNumber: 'G-1' }, COURIERS),
    ).toMatchObject({ ok: true, value: { courierName: 'Other' } });
  });

  it('cuts a typed courier name to eighty characters', () => {
    const checked = guideOf(
      { courierKey: 'other', trackingNumber: 'G', courierName: 'x'.repeat(99) },
      COURIERS,
    );
    expect(checked.ok && checked.value.courierName).toHaveLength(80);
  });

  it.each([
    [{ courierKey: 'fast', trackingNumber: '  ' }, 'trackingNumber'],
    [{ courierKey: 'fast', trackingNumber: 'x'.repeat(65) }, 'trackingNumber'],
    [{ courierKey: 'nobody', trackingNumber: 'G' }, 'courierKey'],
    [
      { courierKey: 'other', trackingNumber: 'G', trackingUrl: 'http://a.b' },
      'trackingUrl',
    ],
    [
      { courierKey: 'other', trackingNumber: 'G', trackingUrl: 'not a url' },
      'trackingUrl',
    ],
    [
      {
        courierKey: 'other',
        trackingNumber: 'G',
        trackingUrl: `https://a.b/${'x'.repeat(2048)}`,
      },
      'trackingUrl',
    ],
  ])('refuses %o on %s', (payload, field) => {
    expect(guideOf(payload, COURIERS)).toMatchObject({ ok: false, field });
  });
});

describe('courierOf', () => {
  it('reads a row as JSON text or as a value', () => {
    expect(
      courierOf(
        'fast',
        '{"name":" Fast ","trackingUrlTemplate":"https://t.example/{guide}"}',
      ),
    ).toEqual({
      key: 'fast',
      name: 'Fast',
      trackingUrlTemplate: 'https://t.example/{guide}',
    });
    expect(
      courierOf('other', { name: 'Other', trackingUrlTemplate: '' }),
    ).toEqual(OTHER);
  });

  it.each([
    ['not json', '{'],
    ['not a record', '"text"'],
    ['null', null],
    ['no name', { trackingUrlTemplate: '' }],
    ['a blank name', { name: ' ', trackingUrlTemplate: '' }],
    ['no template', { name: 'X' }],
    [
      'no placeholder',
      { name: 'X', trackingUrlTemplate: 'https://t.example/' },
    ],
    [
      'two placeholders',
      { name: 'X', trackingUrlTemplate: 'https://t.example/{guide}/{guide}' },
    ],
    [
      'not https',
      { name: 'X', trackingUrlTemplate: 'http://t.example/{guide}' },
    ],
  ])('drops a row with %s', (_why, value) => {
    expect(courierOf('x', value)).toBeUndefined();
  });
});
