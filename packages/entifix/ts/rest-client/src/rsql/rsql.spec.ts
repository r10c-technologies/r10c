import { describe, expect, it } from 'vitest';

import { fromUrl } from './from-url.js';
import { toUrl } from './to-url.js';

describe('toUrl', () => {
  it('emits an rsql query string', () => {
    expect(toUrl('name==Acme')).toBe('?rsql=name%3D%3DAcme');
  });

  it('percent-encodes so operators survive the URL', () => {
    expect(toUrl('a==1;b!=2')).toBe('?rsql=a%3D%3D1%3Bb%21%3D2');
  });

  it('emits an empty parameter for an empty expression', () => {
    expect(toUrl('')).toBe('?rsql=');
  });
});

describe('fromUrl', () => {
  it('reads the rsql parameter back out', () => {
    expect(fromUrl(`http://service/api/product${toUrl('name==Acme')}`)).toBe('name==Acme');
  });

  it.each([
    ['no query string', 'http://service/api/product'],
    ['an unrelated parameter', 'http://service/api/product?page=2'],
    ['an empty rsql parameter', 'http://service/api/product?rsql='],
  ])('yields an empty expression for %s', (_label, url) => {
    expect(fromUrl(url)).toBe('');
  });

  it('round-trips an expression through toUrl', () => {
    const rsql = 'name==Acme;stock=gt=10';

    expect(fromUrl(`http://service/api/product${toUrl(rsql)}`)).toBe(rsql);
  });
});
