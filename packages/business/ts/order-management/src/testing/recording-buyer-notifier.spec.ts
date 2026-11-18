import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { makeRecordingBuyerNotifier } from './recording-buyer-notifier.js';

const MAIL = { to: 'ana@correo.com', subject: 's', text: 't', html: 'h' };

describe('makeRecordingBuyerNotifier', () => {
  it('keeps what it sent, and fails the sends it was told to', async () => {
    const notifier = makeRecordingBuyerNotifier();
    notifier.failNext = 1;

    const failed = await Effect.runPromise(Effect.flip(notifier.send(MAIL)));
    await Effect.runPromise(notifier.send(MAIL));

    expect(failed).toMatchObject({ _tag: 'Unavailable', dependency: 'smtp' });
    expect(notifier.sent).toEqual([MAIL]);
  });
});
