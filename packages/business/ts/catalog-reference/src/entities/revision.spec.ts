import { describe, expect, it } from 'vitest';

import { DictionaryTerm } from '../index.js';

/**
 * The revision check (ADR 0079 §4) is a member the record carries from the read
 * to the save, so each authored entity holds it and gives it back.
 */
describe.each([['DictionaryTerm', DictionaryTerm]] as const)(
  '%s',
  (_name, entityConstructor) => {
    it('carries the revision it was read at', () => {
      const record = new (
        entityConstructor as unknown as new () => {
          revision?: number;
        }
      )();

      expect(record.revision).toBeUndefined();
      record.revision = 3;
      expect(record.revision).toBe(3);
    });
  },
);
