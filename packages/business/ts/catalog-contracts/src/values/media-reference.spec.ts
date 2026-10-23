import { describeEntityColumns, EntifixBuildError } from '@entifix/core';
import { describe, expect, it } from 'vitest';

import {
  isHttpsUrl,
  MEDIA_ALT_MISSING,
  MEDIA_NOT_HTTPS,
  MediaReference,
  mediaRefusal,
  MediaRefusedError,
  readMedia,
} from './media-reference.js';

describe('isHttpsUrl', () => {
  it('accepts an absolute https URL', () => {
    expect(isHttpsUrl('https://cdn.example/a.jpg')).toBe(true);
  });

  // Each of these renders into an `src` on an https page as either blocked
  // mixed content or a hole, so none may pass (ADR 0061).
  it.each([
    ['http', 'http://cdn.example/a.jpg'],
    ['protocol-relative', '//cdn.example/a.jpg'],
    ['relative', '/images/a.jpg'],
    ['javascript', 'javascript:alert(1)'],
    ['data', 'data:image/png;base64,AAAA'],
    ['https in the path only', 'ftp://host/https://x'],
    ['empty', ''],
  ])('refuses a %s URL', (_label, value) => {
    expect(isHttpsUrl(value)).toBe(false);
  });

  it('refuses a value that is not a string', () => {
    expect(isHttpsUrl(42)).toBe(false);
    expect(isHttpsUrl(undefined)).toBe(false);
  });
});

describe('mediaRefusal', () => {
  it('accepts no media and an empty gallery', () => {
    expect(mediaRefusal(undefined)).toBeUndefined();
    expect(mediaRefusal([])).toBeUndefined();
  });

  it('accepts entries that each have an https URL and an alt text', () => {
    expect(
      mediaRefusal([
        { url: 'https://cdn.example/a.jpg', alt: 'Front' },
        { url: 'https://cdn.example/b.jpg', alt: 'Back' },
      ]),
    ).toBeUndefined();
  });

  it('refuses an entry whose URL is not https', () => {
    expect(
      mediaRefusal([{ url: 'http://cdn.example/a.jpg', alt: 'Front' }]),
    ).toBe(MEDIA_NOT_HTTPS);
  });

  it('refuses an entry with a blank alt text', () => {
    expect(
      mediaRefusal([{ url: 'https://cdn.example/a.jpg', alt: '   ' }]),
    ).toBe(MEDIA_ALT_MISSING);
    expect(mediaRefusal([{ url: 'https://cdn.example/a.jpg' }])).toBe(
      MEDIA_ALT_MISSING,
    );
  });

  it('names the unsafe URL first when both rules fail', () => {
    expect(mediaRefusal([{ url: 'javascript:void(0)' }])).toBe(MEDIA_NOT_HTTPS);
  });
});

describe('MediaRefusedError', () => {
  it('is a build error carrying the code the route answers with', () => {
    const error = new MediaRefusedError(MEDIA_NOT_HTTPS);

    expect(error).toBeInstanceOf(EntifixBuildError);
    expect(error.code).toBe(MEDIA_NOT_HTTPS);
  });
});

describe('readMedia', () => {
  it('reads valid entries as plain url and alt values, in order', () => {
    const reference = new MediaReference('https://cdn.example/b.jpg', 'Back');

    expect(
      readMedia([
        { url: 'https://cdn.example/a.jpg', alt: 'Front', extra: 1 },
        reference,
      ]),
    ).toEqual([
      { url: 'https://cdn.example/a.jpg', alt: 'Front' },
      { url: 'https://cdn.example/b.jpg', alt: 'Back' },
    ]);
  });

  it('reads anything that is not a non-empty array of valid entries as absent', () => {
    expect(readMedia(undefined)).toBeUndefined();
    expect(readMedia(null)).toBeUndefined();
    expect(readMedia([])).toBeUndefined();
    expect(readMedia([null, 'x', { url: 'http://a/b', alt: 'x' }])).toBe(
      undefined,
    );
  });
});

describe('MediaReference', () => {
  it('describes two required string columns for a detail grid', () => {
    const columns = describeEntityColumns(MediaReference as never).map(
      column => [column.name, column.type, column.required],
    );

    expect(columns).toEqual([
      ['url', 'string', true],
      ['alt', 'string', true],
    ]);
  });

  it('defaults to empty values and holds what it is given', () => {
    const empty = new MediaReference();
    expect([empty.url, empty.alt]).toEqual(['', '']);

    empty.url = 'https://cdn.example/a.jpg';
    empty.alt = 'Front';
    expect([empty.url, empty.alt]).toEqual([
      'https://cdn.example/a.jpg',
      'Front',
    ]);
  });
});
