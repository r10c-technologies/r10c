import { describe, expect, it } from 'vitest';

import {
  EntifixBuildError,
  EntifixConnError,
  type EntifixError,
  EntifixLockError,
  EntifixLogicError,
  EntifixTransactionError,
} from './entifix-error.js';

/**
 * The `_tag` is what Effect matches on, so every subclass carrying its own tag
 * is the whole point of the hierarchy — a duplicated or missing tag silently
 * routes a failure into the wrong branch.
 */
describe('EntifixError subclasses', () => {
  const cases: [new (message: string) => EntifixError, string][] = [
    [EntifixBuildError, 'EntifixBuildError'],
    [EntifixLogicError, 'EntifixLogicError'],
    [EntifixConnError, 'EntifixConnError'],
    [EntifixTransactionError, 'EntifixTransactionError'],
    [EntifixLockError, 'EntifixLockError'],
  ];

  it.each(cases)('%p carries its own _tag', (Ctor, tag) => {
    const error = new Ctor('boom');

    expect(error._tag).toBe(tag);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('boom');
  });

  it('gives every subclass a distinct tag', () => {
    expect(new Set(cases.map(([, tag]) => tag)).size).toBe(cases.length);
  });
});

describe('cause normalization', () => {
  it('keeps an Error cause as-is', () => {
    const cause = new Error('underlying');

    expect(new EntifixConnError('wrapped', cause).cause).toBe(cause);
  });

  // Driver failures often arrive as plain objects rather than Errors; the
  // message must survive so the log line is still useful.
  it('rebuilds an Error from a message-bearing object', () => {
    const error = new EntifixConnError('wrapped', { message: 'ECONNREFUSED' });

    expect(error.cause).toBeInstanceOf(Error);
    expect(error.cause?.message).toBe('ECONNREFUSED');
  });

  it('stringifies a non-string message on such an object', () => {
    expect(new EntifixConnError('wrapped', { message: 42 }).cause?.message).toBe('42');
  });

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['a string', 'plain'],
    ['a number', 7],
    ['an object without a message', { code: 'E' }],
  ])('drops a cause built from %s', (_label, cause) => {
    expect(new EntifixConnError('wrapped', cause).cause).toBeUndefined();
  });
});

describe('details', () => {
  it('carries structured details through', () => {
    const error = new EntifixBuildError('bad key', undefined, { key: 'uri' });

    expect(error.details).toEqual({ key: 'uri' });
  });

  it('leaves details undefined when none were given', () => {
    expect(new EntifixBuildError('bad key').details).toBeUndefined();
  });
});
