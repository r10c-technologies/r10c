import { EntifixBuildError,entity } from '@r10c/entifix-ts-core';
import { describe, expect, it } from 'vitest';

import {
  Actions,
  parsePermission,
  type Permission,
  permissionFor,
  permissionForEntity,
  permissionMatches,
  permissionOf,
} from './permission.js';

@entity({ domain: 'authn', key: 'user-identity' })
class DescribedEntity {
  id: string | undefined = undefined;
}

@entity({ key: 'no-domain' })
class DomainlessEntity {
  id: string | undefined = undefined;
}

@entity({ domain: 'authn' })
class KeylessEntity {
  id: string | undefined = undefined;
}

describe('permission values', () => {
  it('exposes the three actions', () => {
    expect(Actions).toEqual(['read', 'write', 'delete']);
  });

  it('builds a permission from its parts', () => {
    expect(permissionFor('authn', 'user-identity', 'write')).toBe(
      'authn:user-identity:write',
    );
  });

  it('joins a resource and an action', () => {
    expect(permissionOf('authn:user-identity', 'read')).toBe(
      'authn:user-identity:read',
    );
  });

  describe('permissionForEntity', () => {
    it('derives the permission from the entity metadata', () => {
      expect(permissionForEntity(DescribedEntity, 'read')).toBe(
        'authn:user-identity:read',
      );
    });

    it('rejects an entity without a domain', () => {
      expect(() => permissionForEntity(DomainlessEntity, 'read')).toThrow(
        EntifixBuildError,
      );
    });

    it('rejects an entity without a key', () => {
      expect(() => permissionForEntity(KeylessEntity, 'read')).toThrow(
        EntifixBuildError,
      );
    });
  });

  describe('parsePermission', () => {
    it('splits a permission into resource and action', () => {
      expect(parsePermission('authn:user-identity:write')).toEqual({
        resource: 'authn:user-identity',
        action: 'write',
      });
    });

    it('throws on a permission that is not three segments', () => {
      expect(() =>
        parsePermission('authn:user-identity' as Permission),
      ).toThrow(EntifixBuildError);
    });
  });

  describe('permissionMatches', () => {
    it('matches an exact permission', () => {
      expect(
        permissionMatches('authn:user-identity:read', 'authn:user-identity:read'),
      ).toBe(true);
    });

    it('does not match a different action', () => {
      expect(
        permissionMatches(
          'authn:user-identity:read',
          'authn:user-identity:write',
        ),
      ).toBe(false);
    });

    it('treats `*` on the granted side as a wildcard segment', () => {
      expect(permissionMatches('catalog:*:read', 'catalog:product:read')).toBe(
        true,
      );
      expect(permissionMatches('*:*:*', 'anything:at:all')).toBe(true);
    });

    it('does not treat `*` on the required side as a wildcard', () => {
      expect(permissionMatches('catalog:product:read', 'catalog:*:read')).toBe(
        false,
      );
    });

    it('rejects a malformed granted permission', () => {
      expect(
        permissionMatches('catalog:read' as Permission, 'catalog:product:read'),
      ).toBe(false);
    });

    it('rejects a malformed required permission', () => {
      expect(
        permissionMatches('catalog:*:read', 'catalog:product' as Permission),
      ).toBe(false);
    });
  });
});
