import { EntifixLogicError } from '@r10c/entifix-ts-core';
import { describe, expect, it } from 'vitest';

import { resolveBodyTemplate, resolveTemplate } from './resolve-template.js';

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
    expect(resolveTemplate('/api/{a}/{b}', { a: 'one', b: 'two' })).toBe(
      '/api/one/two',
    );
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
      resolveTemplate('/api/x/{outcome.data.id}', {
        outcome: { data: 'flat' },
      }),
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

describe('resolveBodyTemplate', () => {
  const scope = {
    steps: {
      'write-order': {
        data: { id: 'order-1', total: 4599, lines: [{ n: 1 }] },
      },
    },
  };

  /**
   * ⚠️ A whole placeholder keeps the value's **type**. `"3"` reaching a
   * validator that expects a number is a `400` from inside a flow that has
   * already taken holds.
   */
  it('preserves the type of a value a whole placeholder names', () => {
    expect(resolveBodyTemplate('{steps.write-order.data.total}', scope)).toBe(
      4599,
    );
    expect(
      resolveBodyTemplate('{steps.write-order.data.lines}', scope),
    ).toEqual([{ n: 1 }]);
  });

  it('interpolates a placeholder inside a longer string', () => {
    expect(
      resolveBodyTemplate('order {steps.write-order.data.id} paid', scope),
    ).toBe('order order-1 paid');
  });

  /**
   * ⚠️ **Not URI-encoded, unlike a path.** A body is JSON, and encoding here
   * would put `%20` in a customer's name.
   */
  it('does not encode, because a body is not a path segment', () => {
    expect(
      resolveBodyTemplate('{steps.x.name}', {
        steps: { x: { name: 'a b/c' } },
      }),
    ).toBe('a b/c');
  });

  it('walks objects and arrays', () => {
    expect(
      resolveBodyTemplate(
        {
          data: {
            orderId: '{steps.write-order.data.id}',
            tags: ['{steps.write-order.data.total}'],
          },
        },
        scope,
      ),
    ).toEqual({ data: { orderId: 'order-1', tags: [4599] } });
  });

  it('leaves values that are not strings alone', () => {
    expect(resolveBodyTemplate(7, scope)).toBe(7);
    expect(resolveBodyTemplate(null, scope)).toBeNull();
    expect(resolveBodyTemplate(undefined, scope)).toBeUndefined();
    expect(resolveBodyTemplate(true, scope)).toBe(true);
  });

  it('throws on a placeholder nothing resolves, whole or embedded', () => {
    expect(() => resolveBodyTemplate('{steps.missing.id}', scope)).toThrow(
      /has no value/,
    );
    expect(() => resolveBodyTemplate('x {steps.missing.id}', scope)).toThrow(
      /has no value/,
    );
  });
});
