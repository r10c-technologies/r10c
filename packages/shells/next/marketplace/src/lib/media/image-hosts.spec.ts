import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_IMAGE_HOSTS,
  imageHosts,
  imageLoaderFor,
  parseImageHosts,
} from './image-hosts';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('parseImageHosts', () => {
  it('reads a comma-separated list of hostnames, lower-cased', () => {
    expect(parseImageHosts(' picsum.photos, Media.Example.com ,')).toEqual([
      'picsum.photos',
      'media.example.com',
    ]);
  });

  it('drops anything that is not a plain hostname, never widening it', () => {
    expect(
      parseImageHosts(
        '**,*.example.com,https://a.example,a.example:8443,a.example/x,localhost',
      ),
    ).toEqual([]);
  });
});

describe('imageHosts', () => {
  it('is the seed’s one host when nothing is configured', () => {
    vi.stubEnv('STOREFRONT_IMAGE_HOSTS', undefined);
    expect(imageHosts()).toEqual([DEFAULT_IMAGE_HOSTS]);
  });

  it('is the configured list when there is one', () => {
    vi.stubEnv('STOREFRONT_IMAGE_HOSTS', 'cdn.example.com');
    expect(imageHosts()).toEqual(['cdn.example.com']);
  });
});

describe('imageLoaderFor', () => {
  const HOSTS = ['picsum.photos'];
  const SRC = 'https://picsum.photos/seed/lamp/800/800';

  it('sends an allowed picture through the optimizer at each width', () => {
    const loader = imageLoaderFor(SRC, HOSTS);
    expect(loader?.(SRC, 320)).toBe(
      `/_next/image?url=${encodeURIComponent(SRC)}&w=320&q=75`,
    );
  });

  it.each([
    ['a host not on the list', 'https://elsewhere.example/a.jpg'],
    ['plain http', 'http://picsum.photos/seed/lamp/800/800'],
    ['a relative path', '/a.jpg'],
  ])('leaves %s as it is', (_, src) => {
    expect(imageLoaderFor(src, HOSTS)).toBeUndefined();
  });
});
