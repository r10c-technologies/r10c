import type { DeviceContext } from '@entifix/business';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { UserDeviceRepository } from '../repository/user-device.repository';

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

const device = (deviceId: string, ip = '10.0.0.1'): DeviceContext =>
  ({
    deviceId,
    browser: 'Firefox',
    os: 'Linux',
    type: 'desktop',
    ip,
  }) as DeviceContext;

/**
 * What every {@link UserDeviceRepository} must guarantee: a device is new the
 * first time a user is seen on it and never again — which is what decides
 * whether a new-device notice goes out — it keeps its identity and first
 * sighting while its last address moves, and a user's devices list newest
 * sighting first, nobody else's among them.
 *
 * `make` returns a fresh, empty repository.
 */
export const describeUserDeviceRepositoryContract = (
  name: string,
  make: () => UserDeviceRepository | Promise<UserDeviceRepository>,
) => {
  describe(`${name} honours the UserDeviceRepository contract`, () => {
    it('is new once per user and device, and keeps its identity as it moves', async () => {
      const devices = await make();

      const first = await run(devices.remember('u-1', device('d-1')));
      const again = await run(
        devices.remember('u-1', device('d-1', '10.0.0.2')),
      );
      const elsewhere = await run(devices.remember('u-2', device('d-1')));

      expect(first.isNew).toBe(true);
      expect(again.isNew).toBe(false);
      expect(again.device.id).toBe(first.device.id);
      expect(again.device.lastIp).toBe('10.0.0.2');
      expect(new Date(again.device.firstSeenAt as Date).getTime()).toBe(
        new Date(first.device.firstSeenAt as Date).getTime(),
      );
      expect(elsewhere.isNew).toBe(true);
    });

    it("lists a user's own devices, newest sighting first", async () => {
      const devices = await make();
      await run(devices.remember('u-1', device('d-1')));
      await new Promise(resolve => setTimeout(resolve, 5));
      await run(devices.remember('u-1', device('d-2')));
      await run(devices.remember('u-2', device('d-3')));

      const listed = await run(devices.listForUser('u-1'));

      expect(listed.map(one => one.deviceId)).toEqual(['d-2', 'd-1']);
      expect(await run(devices.listForUser('nobody'))).toEqual([]);
    });
  });
};
