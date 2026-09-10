import { EntifixLogicError } from '@r10c/entifix-ts-core';
import { describe, expect, it } from 'vitest';

import { SalesChannel } from '../../entities/sales-channel/index.js';
import { SELL_AT_CHANNEL, SellAtChannelUC } from './sell-at-channel.uc.js';

const channel = (status: 'active' | 'inactive') => {
  const record = new SalesChannel('Mostrador principal', 'counter');
  record.id = 'sales-channel-counter';
  record.status = status;
  return record;
};

describe('SELL_AT_CHANNEL', () => {
  it('derives the verb from the use case, so `sell` is written once', () => {
    // The source scan checks this string against the grant table, which is the
    // only other place it appears.
    expect(SELL_AT_CHANNEL).toBe('sales-management:sales-channel:sell');
  });
});

describe('SellAtChannelUC', () => {
  it('lets a sale through an active channel', () => {
    const active = channel('active');

    expect(SellAtChannelUC.run(active)).toBe(active);
  });

  it('refuses a retired channel, which the UI hiding it would not', () => {
    // A channel is retired by state rather than deletion, because every order
    // placed through one keeps referring to it — so it stays readable, stays
    // pickable by anything that does not check, and would keep taking sales the
    // vendor believes are impossible.
    expect(() => SellAtChannelUC.run(channel('inactive'))).toThrow(
      EntifixLogicError,
    );
  });

  it('names the channel and its state on the refusal', () => {
    // The route answers `409 channelInactive` from this, and an operator
    // reading the log needs to know which counter refused.
    try {
      SellAtChannelUC.run(channel('inactive'));
      expect.unreachable('a retired channel must not take a sale');
    } catch (error) {
      expect((error as EntifixLogicError).details).toEqual({
        channelId: 'sales-channel-counter',
        status: 'inactive',
      });
    }
  });
});
