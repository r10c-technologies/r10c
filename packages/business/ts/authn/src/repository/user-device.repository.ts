import type { DeviceContext } from '@r10c/entifix-ts-business';
import type { EntifixError, EntityId } from '@r10c/entifix-ts-core';
import { Context } from 'effect';
import { Effect } from 'effect/Effect';

import type { UserDevice } from '../entities/user-device';

/** What {@link UserDeviceRepository.remember} answers. */
export interface RememberedDevice {
  readonly device: UserDevice;
  /**
   * True the first time this user is seen on this device.
   *
   * The single reason the repository is durable rather than derived from live
   * sessions: sessions expire, so a familiar laptop would look new after a week
   * away, and an alert that cries wolf is worse than no alert.
   */
  readonly isNew: boolean;
}

/**
 * Durable record of the browsers a user signs in from.
 *
 * Everything here is a label for display and for notifying the account owner.
 * No caller may treat a device as evidence of anything — the access token is
 * what authorizes, and a copied cookie copies the device.
 */
export interface UserDeviceRepository {
  /**
   * Record a sign-in from `device`, creating the row on first sight and
   * refreshing `lastSeenAt` afterwards.
   */
  remember(
    userId: EntityId,
    device: DeviceContext,
  ): Effect<RememberedDevice, EntifixError>;
  /** Every device known for a user, most recently seen first. */
  listForUser(userId: EntityId): Effect<readonly UserDevice[], EntifixError>;
}

/** DI tag the composition root binds to a concrete {@link UserDeviceRepository}. */
export class UserDeviceRepositoryTag extends Context.Tag(
  'UserDeviceRepositoryTag',
)<UserDeviceRepositoryTag, UserDeviceRepository>() {}
