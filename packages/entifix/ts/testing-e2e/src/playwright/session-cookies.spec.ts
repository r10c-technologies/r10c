import * as core from '@entifix/core';
import { describe, expect, it } from 'vitest';

import * as session from './session.js';

/**
 * `session.ts` writes the cookie names out instead of importing them, because
 * Nx loads it at graph time with nothing built. This is what keeps that copy
 * honest: a spec runs through Vitest with the source condition, so it can import
 * core, and it fails the moment either side renames a cookie without the other.
 */
describe('the seeded session cookies', () => {
  it.each(['ACCESS_COOKIE', 'SESSION_COOKIE', 'LOCALE_COOKIE'] as const)(
    '%s matches the name @entifix/core declares',
    name => {
      expect(
        session[name],
        `session.ts seeds ${session[name]} but @entifix/core names it ` +
          `${core[name]} — a seeded session would be invisible to every reader`,
      ).toBe(core[name]);
    },
  );
});
