import { Unavailable } from '@entifix/core';
import { Effect } from 'effect';

import type { BuyerMail, BuyerNotifier } from '../ports/buyer-notifier';

/**
 * A {@link BuyerNotifier} that keeps what it was asked to send, for the specs
 * and the mock profile of whatever sends mail. `failNext` makes the next send
 * fail `Unavailable`, as a mail server that did not answer would.
 */
export const makeRecordingBuyerNotifier = (): BuyerNotifier & {
  readonly sent: BuyerMail[];
  failNext: number;
} => {
  const sent: BuyerMail[] = [];
  const notifier = {
    sent,
    failNext: 0,
    send: (mail: BuyerMail) =>
      Effect.suspend(() => {
        if (notifier.failNext > 0) {
          notifier.failNext -= 1;
          return Effect.fail(new Unavailable({ dependency: 'smtp' }));
        }
        sent.push(mail);
        return Effect.void;
      }),
  };
  return notifier;
};
