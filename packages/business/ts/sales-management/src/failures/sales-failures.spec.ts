import { isFailure } from '@entifix/core';
import { describe, expect, it } from 'vitest';

import {
  ChannelInactive,
  OfferingNotYours,
  StockUnavailable,
} from './sales-failures.js';

describe('the counter sale refusals', () => {
  it('are typed failures with the codes the errors catalog renders', () => {
    const refusals = [
      new ChannelInactive({ channelId: 'c' }),
      new OfferingNotYours({ offeringId: 'o-1' }),
      new StockUnavailable({ channelId: 'c' }),
    ];

    expect(refusals.every(isFailure)).toBe(true);
    expect(
      refusals.map(refusal => [
        refusal.code,
        refusal.category,
        refusal.message,
      ]),
    ).toEqual([
      [
        'channelInactive',
        'conflict',
        'a retired sales channel cannot take a sale',
      ],
      [
        'notYours',
        'forbidden',
        `the offering "o-1" is not this organization's to sell`,
      ],
      [
        'stockUnavailable',
        'conflict',
        'a line could not be held, and every hold taken was released',
      ],
    ]);
  });
});
