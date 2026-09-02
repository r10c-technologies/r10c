import { describe, expect, it } from 'vitest';

import {
  isScreenType,
  SCREEN_TYPE_LABEL_KEYS,
  screenTypeRank,
  ScreenTypes,
} from './screen-type.js';

describe('screen type values', () => {
  it('is the four types of ADR 0033, in sidebar order', () => {
    expect(ScreenTypes).toEqual(['master', 'operation', 'wizard', 'report']);
  });

  it('names every type in the shell catalog and nowhere else', () => {
    expect(Object.keys(SCREEN_TYPE_LABEL_KEYS).sort()).toEqual(
      [...ScreenTypes].sort(),
    );
    for (const key of Object.values(SCREEN_TYPE_LABEL_KEYS)) {
      expect(key.startsWith('shell:nav.screenType.')).toBe(true);
    }
  });

  describe('isScreenType', () => {
    it('accepts a known type', () => {
      expect(isScreenType('wizard')).toBe(true);
    });

    it('rejects an unknown string', () => {
      // The Spanish copy is not the identifier — three of the four differ.
      expect(isScreenType('asistente')).toBe(false);
    });

    it('rejects a non-string', () => {
      expect(isScreenType(0)).toBe(false);
    });
  });

  describe('screenTypeRank', () => {
    it('ranks the types in declaration order', () => {
      expect(screenTypeRank('master')).toBe(0);
      expect(screenTypeRank('report')).toBe(3);
    });

    it('sorts an untyped section last', () => {
      // The account surface. It is not a screen group, so it goes below the
      // sections that are — never interleaved with them.
      expect(screenTypeRank(undefined)).toBeGreaterThan(
        screenTypeRank('report'),
      );
    });
  });
});
