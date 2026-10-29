import { type AnyEndpointGroup, endpointsOf } from '@entifix/service-shell';
import { endpoints as configEndpoints } from '@r10c/shells-effect-config';
import { serviceBaseGroup } from '@r10c/shells-effect-service';
import { describe, expect, it } from 'vitest';

import { SLICES } from './registry.js';
import { endpointDrift, expandApis } from './served-endpoints.js';

/**
 * Every slice whose shell builds its API from descriptors, with the groups it
 * serves (ADR 0071). Each slice's migration adds its entry; the commit that
 * moves the last cell makes this cover every active slice.
 */
const SERVED: Readonly<Record<string, readonly AnyEndpointGroup[]>> = {
  config: configEndpoints,
};

/**
 * What a slice's shell serves of its own: every group but the fleet's —
 * `/api/config` and `/api/me`, which every service serves and no slice
 * declares. By group rather than by path, because config-service's own
 * `GET /api/config` is a different endpoint at the same path.
 */
const servedBy = (groups: readonly AnyEndpointGroup[]) =>
  endpointsOf(
    groups.filter(
      group =>
        group.name !==
        serviceBaseGroup({ service: 'any', store: 'mongo' }).name,
    ),
  );

describe('the endpoints a slice declares', () => {
  it.each(Object.entries(SERVED))(
    "are exactly what %s's shell serves",
    (name, groups) => {
      const slice = SLICES.find(candidate => candidate.name === name);

      expect(slice, `no slice is declared as '${name}'`).toBeDefined();
      expect(endpointDrift(slice?.exposedAPIs ?? [], servedBy(groups))).toEqual(
        { missing: [], extra: [] },
      );
    },
  );

  // A path outside `/api/` is a foreign system's — Zitadel's admin API — and
  // no slice declares it.
  it('name, in every dependantAPIs entry, an endpoint some slice declares', () => {
    const exposed = new Set(
      SLICES.flatMap(slice => expandApis(slice.exposedAPIs)),
    );
    const dangling = SLICES.flatMap(slice =>
      expandApis(slice.dependantAPIs)
        .filter(endpoint => endpoint.split(' ')[1]?.startsWith('/api/'))
        .filter(endpoint => !exposed.has(endpoint))
        .map(endpoint => `${slice.name} → ${endpoint}`),
    );

    expect(dangling).toEqual([]);
  });
});

describe('the parity check', () => {
  it('reads a brace group as one path per alternative', () => {
    expect(expandApis(['GET|DELETE /api/x{,/:id}'])).toEqual([
      'DELETE /api/x',
      'DELETE /api/x/:id',
      'GET /api/x',
      'GET /api/x/:id',
    ]);
  });

  const declared = ['GET|POST /api/thing', 'GET /api/thing/:id'];

  it('passes a shell that serves exactly what is declared', () => {
    expect(
      endpointDrift(declared, [
        'GET /api/thing',
        'POST /api/thing',
        'GET /api/thing/:id',
      ]),
    ).toEqual({ missing: [], extra: [] });
  });

  it('catches an endpoint served and never declared (planted)', () => {
    expect(
      endpointDrift(declared, [
        'GET /api/thing',
        'POST /api/thing',
        'GET /api/thing/:id',
        'DELETE /api/thing/:id',
      ]).extra,
    ).toEqual(['DELETE /api/thing/:id']);
  });

  it('catches an endpoint declared and never served (planted)', () => {
    expect(
      endpointDrift(declared, ['GET /api/thing', 'GET /api/thing/:id']).missing,
    ).toEqual(['POST /api/thing']);
  });
});
