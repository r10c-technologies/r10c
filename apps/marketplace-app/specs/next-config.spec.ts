import { createRequire } from 'node:module';

import { MEDIA_IMAGE_WIDTHS } from '@entifix/react-controls/primitives';
import {
  DEFAULT_IMAGE_HOSTS,
  IMAGE_QUALITY,
  parseImageHosts,
} from '@r10c/shells-next-marketplace/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * `next.config.js` is plain CommonJS and cannot import the shell, so the
 * image host list is parsed in both. This holds them to each other: a host
 * the shell sends through the optimizer that the config does not allow is a
 * broken picture, and the reverse is a fetch nobody asked for (#571).
 */
const require = createRequire(import.meta.url);
const loadConfig = () => {
  const path = require.resolve('../next.config.js');
  delete require.cache[path];
  return require(path) as {
    images: {
      remotePatterns: readonly { hostname: string; protocol: string }[];
      deviceSizes: readonly number[];
      qualities: readonly number[];
    };
  };
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the image optimizer configuration', () => {
  it.each([
    ['unset', undefined],
    [
      'a configured list',
      'cdn.example.com, **, Media.Example.com:8443, a.example',
    ],
  ])('allows exactly the hosts the shell does, when %s', (_, raw) => {
    vi.stubEnv('STOREFRONT_IMAGE_HOSTS', raw);
    const { images } = loadConfig();

    expect(images.remotePatterns.map(pattern => pattern.hostname)).toEqual(
      parseImageHosts(raw ?? DEFAULT_IMAGE_HOSTS),
    );
    expect(
      images.remotePatterns.every(pattern => pattern.protocol === 'https'),
    ).toBe(true);
  });

  it('accepts every width and the quality the loader asks for', () => {
    const { images } = loadConfig();

    expect(images.deviceSizes).toEqual([...MEDIA_IMAGE_WIDTHS]);
    expect(images.qualities).toEqual([IMAGE_QUALITY]);
  });
});
