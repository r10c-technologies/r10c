import { describe, expect, it } from 'vitest';

import { redactConfiguration, redactValue } from './redact-configuration.js';

// This is what stands between `GET /api/config` and a database password in a
// screenshot, so the cases that must NOT leak are the point of the suite.
describe('redactValue', () => {
  it.each([
    ['mongodb://user:pass@host:27017/db', 'mongodb://***:***@host:27017/db'],
    ['redis://user:pass@host:6379', 'redis://***:***@host:6379'],
    ['postgresql://u:p@host:5432/db', 'postgresql://***:***@host:5432/db'],
    ['amqp://guest:guest@host:5672', 'amqp://***:***@host:5672'],
  ])('masks the credentials in %s', (uri, expected) => {
    expect(redactValue(uri)).toBe(expected);
  });

  it('masks a scheme with punctuation in its name', () => {
    expect(redactValue('mongodb+srv://u:p@cluster.test')).toBe(
      'mongodb+srv://***:***@cluster.test',
    );
  });

  it('is case-insensitive about the scheme', () => {
    expect(redactValue('MongoDB://u:p@host')).toBe('MongoDB://***:***@host');
  });

  it.each([
    ['a URI with no credentials', 'mongodb://host:27017/db'],
    ['a URI with only a username', 'mongodb://user@host'],
    ['a plain string', 'catalog'],
    ['an empty string', ''],
    ['a path that merely contains an @', '/data/@latest'],
  ])('leaves %s untouched', (_label, value) => {
    expect(redactValue(value)).toBe(value);
  });

  it.each([
    ['a number', 3100],
    ['a boolean', true],
    ['null', null],
    ['undefined', undefined],
    ['an object', { nested: 'value' }],
  ])('passes %s through unchanged', (_label, value) => {
    expect(redactValue(value)).toBe(value);
  });

  // Only the first credential pair belongs to the authority section; a later
  // `user:pass@` is part of the path or query and is not a credential.
  it('masks only the authority section', () => {
    expect(redactValue('mongodb://u:p@host/db?other=a:b@c')).toBe(
      'mongodb://***:***@host/db?other=a:b@c',
    );
  });
});

describe('redactConfiguration', () => {
  it('redacts every group without dropping anything', () => {
    const redacted = redactConfiguration({
      mongo: [
        { key: 'uri', value: 'mongodb://user:pass@host/db' },
        { key: 'db', value: 'catalog' },
      ],
      server: [{ key: 'port', value: 3100 }],
    });

    expect(redacted).toEqual({
      mongo: [
        { key: 'uri', value: 'mongodb://***:***@host/db' },
        { key: 'db', value: 'catalog' },
      ],
      server: [{ key: 'port', value: 3100 }],
    });
  });

  it('does not mutate the configuration it was given', () => {
    const plain = { mongo: [{ key: 'uri', value: 'mongodb://user:pass@host' }] };

    redactConfiguration(plain);

    expect(plain.mongo[0]?.value).toBe('mongodb://user:pass@host');
  });

  it.each([
    ['an empty configuration', {}],
    ['a group with no items', { mongo: [] }],
  ])('handles %s', (_label, plain) => {
    expect(redactConfiguration(plain)).toEqual(plain);
  });
});
