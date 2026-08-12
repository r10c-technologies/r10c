import {
  DEFAULT_ROLE,
  permissionForEntity,
  Roles,
} from '@r10c/business-ts-authz';
import {
  describeEntityColumns,
  deserializeSingleEntity,
  serializeEntity,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  EntityIdentifier,
  IdentifierType,
} from './entity-identifier/entity-identifier.entity.js';
import { UserDevice } from './user-device/user-device.entity.js';
import {
  UserIdentity,
  UserStatus,
} from './user-identity/user-identity.entity.js';

describe('EntityIdentifier', () => {
  it('takes its type and value from the constructor', () => {
    const identifier = new EntityIdentifier(IdentifierType.Email, 'a@b.test');

    expect(identifier.type).toBe('email');
    expect(identifier.value).toBe('a@b.test');
  });

  // A fresh identifier is unverified: treating an unverified address as
  // verified is exactly the mistake that lets an unproven email log in.
  it('starts unverified', () => {
    expect(
      new EntityIdentifier(IdentifierType.Email, 'a@b.test').verified,
    ).toBe(false);
  });

  it('round-trips every accessor through its setter', () => {
    const identifier = new EntityIdentifier(IdentifierType.Email, 'a@b.test');
    identifier.id = 'i-1';
    identifier.userId = 'u-1';
    identifier.type = IdentifierType.ExternalSubject;
    identifier.value = 'zitadel-sub-1';
    identifier.provider = 'zitadel';
    identifier.verified = true;

    expect(serializeEntity(EntityIdentifier, identifier)).toEqual({
      id: 'i-1',
      userId: 'u-1',
      type: 'external-subject',
      value: 'zitadel-sub-1',
      provider: 'zitadel',
      verified: true,
    });
  });

  it('leaves the provider unset for a local identifier', () => {
    const identifier = new EntityIdentifier(IdentifierType.Username, 'ada');

    expect(identifier.provider).toBeUndefined();
    expect(serializeEntity(EntityIdentifier, identifier)).not.toHaveProperty(
      'provider',
    );
  });

  it('enumerates every way a user can present themselves', () => {
    expect(Object.values(IdentifierType)).toEqual([
      'email',
      'username',
      'phone',
      'oauth',
      'external-subject',
    ]);
  });
});

describe('UserIdentity', () => {
  // Active-by-default matters: a user created without an explicit status must
  // not silently land in a state authorization treats as unable to sign in.
  it('starts active', () => {
    expect(new UserIdentity().status).toBe(UserStatus.Active);
  });

  // Same reasoning as `status`: an account that materializes without an
  // explicit role must land on the least-privileged tier, never a higher one.
  it('starts at the lowest role', () => {
    expect(new UserIdentity().role).toBe(DEFAULT_ROLE);
  });

  it('round-trips its scalar accessors', () => {
    const user = new UserIdentity();
    user.id = 'u-1';
    user.displayName = 'Ada';
    user.status = UserStatus.Suspended;
    user.role = 'admin';

    expect(serializeEntity(UserIdentity, user)).toMatchObject({
      id: 'u-1',
      displayName: 'Ada',
      status: 'suspended',
      role: 'admin',
    });
  });

  // The role has to arrive as a queryable enum member or generic UI cannot
  // render it and the server-side filter allowlist will reject it.
  it('describes the role as a filterable, sortable enum', () => {
    const roleColumn = describeEntityColumns(UserIdentity).find(
      column => column.name === 'role',
    );

    expect(roleColumn).toMatchObject({
      type: 'enum',
      label: 'Role',
      sortable: true,
      filterable: true,
    });
    expect(roleColumn?.enumValues).toEqual([...Roles]);
  });

  it('initializes identifiers as an empty collection link', () => {
    const user = new UserIdentity();

    expect(user.identifiers.entityConstructor).toBe(EntityIdentifier);
    expect(user.identifiers.isLoaded).toBe(false);
    expect(user.identifiers.ids).toEqual([]);
  });

  it('deserializes embedded identifiers into instances', () => {
    const user = Effect.runSync(
      deserializeSingleEntity(UserIdentity, {
        id: 'u-1',
        identifiers: [
          { id: 'i-1', type: 'email', value: 'a@b.test' },
          {
            id: 'i-2',
            type: 'external-subject',
            value: 'sub-1',
            provider: 'zitadel',
          },
        ],
      }),
    );

    expect(user?.identifiers.isLoaded).toBe(true);
    expect(user?.identifiers.values?.[0]).toBeInstanceOf(EntityIdentifier);
    expect(
      user?.identifiers.values?.map(identifier => identifier.type),
    ).toEqual(['email', 'external-subject']);
  });

  it('deserializes foreign-key identifiers without loading them', () => {
    const user = Effect.runSync(
      deserializeSingleEntity(UserIdentity, {
        id: 'u-1',
        identifiers: ['i-1', 'i-2'],
      }),
    );

    expect(user?.identifiers.isLoaded).toBe(false);
    expect(user?.identifiers.ids).toEqual(['i-1', 'i-2']);
  });

  it('enumerates every lifecycle state', () => {
    expect(Object.values(UserStatus)).toEqual([
      'active',
      'suspended',
      'disabled',
    ]);
  });
});

describe('UserDevice', () => {
  it('round-trips every accessor through its setter', () => {
    const device = new UserDevice();
    device.id = 'd-1';
    device.userId = 'u-1';
    device.deviceId = 'opaque-cookie-value';
    device.browser = 'Chrome';
    device.os = 'macOS';
    device.type = 'desktop';
    device.lastIp = '203.0.113.0';
    device.firstSeenAt = new Date('2026-01-01T00:00:00.000Z');
    device.lastSeenAt = new Date('2026-07-26T00:00:00.000Z');

    expect(serializeEntity(UserDevice, device)).toEqual({
      id: 'd-1',
      userId: 'u-1',
      deviceId: 'opaque-cookie-value',
      browser: 'Chrome',
      os: 'macOS',
      type: 'desktop',
      lastIp: '203.0.113.0',
      firstSeenAt: new Date('2026-01-01T00:00:00.000Z'),
      lastSeenAt: new Date('2026-07-26T00:00:00.000Z'),
    });
  });

  it('starts blank, with no device recorded', () => {
    const device = new UserDevice();

    expect(device.deviceId).toBe('');
    expect(device.browser).toBeUndefined();
    expect(device.lastSeenAt).toBeUndefined();
  });

  it('exposes the members a device list renders', () => {
    const columns = describeEntityColumns(UserDevice).map(
      column => column.name,
    );

    expect(columns).toEqual(
      expect.arrayContaining(['browser', 'os', 'lastSeenAt', 'lastIp']),
    );
  });

  it('derives its permission vocabulary from the entity key', () => {
    // `authn:user-device:read` is what guards another user's device history;
    // the key here is the single source that permission is built from.
    expect(permissionForEntity(UserDevice, 'read')).toBe(
      'authn:user-device:read',
    );
  });
});
