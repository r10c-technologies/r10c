import { EntifixLogicError } from '@r10c/entifix-ts-core';
import { describe, expect, it } from 'vitest';

import { resolveTemplate } from './resolve-template.js';

describe('resolveTemplate', () => {
  it('leaves a template with no placeholder alone', () => {
    expect(resolveTemplate('/api/reservation', {})).toBe('/api/reservation');
  });

  it('resolves a nested field path', () => {
    expect(
      resolveTemplate('/api/reservation/{outcome.data.id}', {
        outcome: { data: { id: 'r-1' } },
      }),
    ).toBe('/api/reservation/r-1');
  });

  it('resolves several placeholders in one template', () => {
    expect(
      resolveTemplate('/api/{a}/{b}', { a: 'one', b: 'two' }),
    ).toBe('/api/one/two');
  });

  /** An id is data, and a path segment is not the place to discover a slash. */
  it('URI-encodes the value it interpolates', () => {
    expect(resolveTemplate('/api/x/{id}', { id: 'a/b c' })).toBe(
      '/api/x/a%2Fb%20c',
    );
  });

  it('stringifies a non-string value', () => {
    expect(resolveTemplate('/api/x/{n}', { n: 7 })).toBe('/api/x/7');
  });

  /**
   * ⚠️ The failure this prevents is silent: interpolating `undefined` would
   * `DELETE /api/reservation/undefined`, take the `404`, and record a
   * compensation as having run while the hold stayed in place.
   */
  it('throws rather than interpolating a missing value', () => {
    expect(() => resolveTemplate('/api/x/{outcome.data.id}', {})).toThrow(
      EntifixLogicError,
    );
    expect(() => resolveTemplate('/api/x/{missing}', {})).toThrow(
      /has no value for '\{missing\}'/,
    );
  });

  it('throws when a path runs through a non-object', () => {
    expect(() =>
      resolveTemplate('/api/x/{outcome.data.id}', { outcome: { data: 'flat' } }),
    ).toThrow(EntifixLogicError);
  });

  it('throws on an explicit null as firmly as on an absence', () => {
    expect(() => resolveTemplate('/api/x/{id}', { id: null })).toThrow(
      EntifixLogicError,
    );
  });

  it('carries the template and the path in its error details', () => {
    try {
      resolveTemplate('/api/x/{id}', {});
      expect.unreachable('resolveTemplate should have thrown');
    } catch (error) {
      expect((error as EntifixLogicError).details).toEqual({
        template: '/api/x/{id}',
        path: 'id',
      });
    }
  });
});
