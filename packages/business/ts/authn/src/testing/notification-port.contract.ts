import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  type Notification,
  NotificationKind,
  type NotificationPort,
} from '../repository/notification.repository';

/** A port under test, and the notices it has delivered to one address. */
export interface NotificationSubject {
  readonly port: NotificationPort;
  readonly deliveredTo: (
    address: string,
  ) => Promise<ReadonlyArray<Pick<Notification, 'kind' | 'data'>>>;
}

/**
 * What every {@link NotificationPort} must guarantee: a notice reaches the
 * address it names, with its kind and data, and no other address.
 *
 * `make` returns a fresh subject that has delivered nothing.
 */
export const describeNotificationPortContract = (
  name: string,
  make: () => NotificationSubject | Promise<NotificationSubject>,
) => {
  describe(`${name} honours the NotificationPort contract`, () => {
    it('delivers each notice to the address it names, and to no other', async () => {
      const { port, deliveredTo } = await make();

      await Effect.runPromise(
        port.send({
          kind: NotificationKind.NewDevice,
          userId: 'u-1',
          to: 'ada@example.com',
          data: { browser: 'Firefox' },
        }),
      );
      await Effect.runPromise(
        port.send({
          kind: NotificationKind.SessionsRevoked,
          userId: 'u-1',
          to: 'ada@example.com',
        }),
      );

      const delivered = await deliveredTo('ada@example.com');

      expect(delivered).toHaveLength(2);
      expect(delivered).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'new-device',
            data: { browser: 'Firefox' },
          }),
          expect.objectContaining({ kind: 'sessions-revoked' }),
        ]),
      );
      expect(await deliveredTo('someone@else')).toEqual([]);
    });
  });
};
