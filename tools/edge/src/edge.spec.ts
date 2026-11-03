/**
 * The generator's own behaviour. What the rendered files must *say* — the port
 * convention, the stream timeout, the redaction — is asserted, with plants, by
 * `@r10c/docs-check`, against the same functions.
 */
import { describe, expect, it } from 'vitest';

import { envoyConfig, nextCluster, REALTIME_CLUSTER } from './envoy.js';
import { gatewayManifests } from './gateway.js';
import { ORIGINS, upstreamOf } from './routes.js';
import { toYaml, toYamlStream } from './yaml.js';

describe('toYaml', () => {
  it('leaves a plain word bare and quotes anything YAML would reinterpret', () => {
    expect(
      toYaml({
        name: 'origin_3000',
        path: '/api/realtime',
        timeout: '0s',
        word: 'on',
        address: '0.0.0.0',
        '@type': 'x',
        format: '%START_TIME%\n',
        port: 3000,
        on: true,
      }),
    ).toBe(
      [
        'name: origin_3000',
        'path: /api/realtime',
        'timeout: "0s"',
        'word: "on"',
        'address: "0.0.0.0"',
        '"@type": x',
        'format: "%START_TIME%\\n"',
        'port: 3000',
        '"on": true',
        '',
      ].join('\n'),
    );
  });

  it('nests maps in sequences, and writes empty collections inline', () => {
    expect(toYaml({ list: [{ a: 1, b: [2] }, 'c'], empty: {}, none: [] })).toBe(
      [
        'list:',
        '  - a: 1',
        '    b:',
        '      - 2',
        '  - c',
        'empty: {}',
        'none: []',
        '',
      ].join('\n'),
    );
  });

  it('separates documents in a stream', () => {
    expect(toYamlStream([{ a: 1 }, { b: 2 }])).toBe('a: 1\n---\nb: 2\n');
  });
});

describe('the route table', () => {
  it('gives every origin a Next cluster at the origin + 200, and one realtime cluster', () => {
    const clusters = (
      envoyConfig() as { static_resources: { clusters: { name: string }[] } }
    ).static_resources.clusters.map(cluster => cluster.name);

    expect(clusters).toEqual([
      ...ORIGINS.map(origin => `next_${String(origin.origin + 200)}`),
      REALTIME_CLUSTER,
    ]);
    expect(ORIGINS.map(nextCluster)).toEqual(
      ORIGINS.map(origin => `next_${String(upstreamOf(origin))}`),
    );
  });

  it('renders one HTTPRoute per origin, named for its app', () => {
    expect(
      gatewayManifests()['httproutes.yaml']?.map(
        route => (route as { metadata: { name: string } }).metadata.name,
      ),
    ).toEqual(ORIGINS.map(origin => origin.app));
  });
});
