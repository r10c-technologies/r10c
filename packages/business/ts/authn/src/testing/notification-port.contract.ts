import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { DevMailbox } from '../repository/identity-provider-ports';
import {
  NotificationKind,
  type NotificationPort,
} from '../repository/notification.repository';

/** A port under test, and the development mailbox that reads what it sent. */
export interface NotificationSubject {
  readonly port: NotificationPort;
  readonly mailbox: DevMailbox;
}

/**
 * What every development {@link NotificationPort} and its {@link DevMailbox}
 * must guarantee together: a notice reaches the address it names, with its
 * kind and data; the mailbox reads one address's notices or everyone's,
 * newest first.
 *
 * `make` returns a fresh subject that has sent nothing.
 */
export const describeNotificationPortContract = (
  name: string,
  make: () => NotificationSubject | Promise<NotificationSubject>,
) => {
  describe(`${name} honours the NotificationPort contract`, () => {
    const read = (mailbox: DevMailbox, to: string | undefined) =>
      Effect.runPromise(mailbox.read(to));

    it('delivers each notice to the address it names, newest first, and to no other', async () => {
      const { port, mailbox } = await make();

      await Effect.runPromise(
        port.send({
          kind: NotificationKind.NewDevice,
          userId: 'u-1',
          to: 'ada@example.com',
          data: { browser: 'Firefox' },
        }),
      );
      await new Promise(resolve => setTimeout(resolve, 5));
      await Effect.runPromise(
        port.send({
          kind: NotificationKind.SessionsRevoked,
          userId: 'u-1',
          to: 'ada@example.com',
        }),
      );
      await Effect.runPromise(
        port.send({
          kind: NotificationKind.NewDevice,
          userId: 'u-2',
          to: 'grace@example.com',
        }),
      );

      const delivered = await read(mailbox, 'ada@example.com');

      expect(delivered.map(notice => notice.kind)).toEqual([
        'sessions-revoked',
        'new-device',
      ]);
      expect(delivered[1]).toMatchObject({
        to: 'ada@example.com',
        userId: 'u-1',
        data: { browser: 'Firefox' },
      });
      expect(await read(mailbox, 'nobody@example.com')).toEqual([]);
      expect(await read(mailbox, undefined)).toHaveLength(3);
    });
  });
};
