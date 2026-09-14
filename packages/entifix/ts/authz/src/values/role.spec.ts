import { describe, expect, it } from 'vitest';

import {
  canAssignRole,
  DEFAULT_ROLE,
  highestRank,
  isRole,
  ROLE_RANK,
  Roles,
} from './role.js';

describe('role values', () => {
  it('orders the three tiers', () => {
    expect(Roles).toEqual(['user', 'admin', 'super-admin']);
    expect(ROLE_RANK.user).toBeLessThan(ROLE_RANK.admin);
    expect(ROLE_RANK.admin).toBeLessThan(ROLE_RANK['super-admin']);
    expect(DEFAULT_ROLE).toBe('user');
  });

  describe('isRole', () => {
    it('accepts a known role', () => {
      expect(isRole('admin')).toBe(true);
    });

    it('rejects an unknown string', () => {
      expect(isRole('root')).toBe(false);
    });

    it('rejects a non-string', () => {
      expect(isRole(1)).toBe(false);
    });
  });

  describe('highestRank', () => {
    it('takes the highest of several roles', () => {
      expect(highestRank(['user', 'super-admin', 'admin'])).toBe(
        ROLE_RANK['super-admin'],
      );
    });

    it('ignores unrecognised roles', () => {
      expect(highestRank(['root', 'admin'])).toBe(ROLE_RANK.admin);
    });

    it('is -1 with no usable role', () => {
      expect(highestRank([])).toBe(-1);
      expect(highestRank(['root'])).toBe(-1);
    });
  });

  describe('canAssignRole', () => {
    it('lets an actor assign at its own tier', () => {
      expect(canAssignRole(['admin'], 'admin')).toBe(true);
    });

    it('lets an actor assign below its tier', () => {
      expect(canAssignRole(['admin'], 'user')).toBe(true);
    });

    it('refuses to let an actor assign above its tier', () => {
      expect(canAssignRole(['admin'], 'super-admin')).toBe(false);
      expect(canAssignRole(['user'], 'admin')).toBe(false);
    });

    it('lets a super-admin assign anything', () => {
      expect(canAssignRole(['super-admin'], 'super-admin')).toBe(true);
    });

    it('refuses an actor with no roles', () => {
      expect(canAssignRole([], 'user')).toBe(false);
    });
  });
});
