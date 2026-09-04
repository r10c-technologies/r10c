import { describe, expect, it } from 'vitest';

import { AUTH_SEARCH_SOURCES } from './search-sources';

/**
 * As with the catalog's declarations, importing the module is most of the test:
 * `defineRecordSearchSource` re-runs its guards against `UserIdentity`'s live
 * metadata, so dropping `filterable` from `displayName` fails here rather than
 * turning the palette's people group into one it could not reach.
 */
describe('AUTH_SEARCH_SOURCES', () => {
  it('declares people as a searchable record', () => {
    expect(AUTH_SEARCH_SOURCES.map(source => source.key)).toEqual([
      'user-identity',
    ]);
    expect(AUTH_SEARCH_SOURCES[0]?.labelKey).toBe('entity:user-identity.plural');
  });

  it('searches auth-service by display name, sorted by it', () => {
    const url = AUTH_SEARCH_SOURCES[0]?.url('ada', 5) ?? '';
    const params = new URL(url).searchParams;

    expect(url).toContain('localhost:3102/api/user-identity');
    expect(params.get('rsql')).toBe('displayName=like=ada');
    expect(params.get('sort')).toBe('+displayName');
    expect(params.get('pageSize')).toBe('5');
  });

  it('routes a result to the user page this host serves', () => {
    const [option] =
      AUTH_SEARCH_SOURCES[0]?.read({
        meta: { type: 'entityPage', entity: 'user-identity' },
        data: {
          items: [{ id: 'u-1', displayName: 'Ada', role: 'admin' }],
          total: 1,
        },
      })?.items ?? [];

    expect(option).toMatchObject({
      id: 'u-1',
      label: 'Ada',
      sublabel: 'admin',
      entity: 'user-identity',
      href: '/users/u-1',
    });
  });
});
