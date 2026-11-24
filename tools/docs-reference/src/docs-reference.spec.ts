import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { endpointsOf, serviceApi } from '@entifix/service-shell';
import { SLICES } from '@r10c/slices';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { placedFrom } from './layout.js';
import { serviceDocuments, SERVICES } from './openapi.js';
import { flowCatalogDocument, flowScenarios, SCENARIOS } from './scenarios.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('the flow scenarios', async () => {
  const document = await flowCatalogDocument();

  it('all compose', () => {
    expect(document.scenarios.map(scenario => scenario.id)).toEqual(
      SCENARIOS.map(scenario => scenario.id),
    );
  });

  it('draw every recipe the coordinator runs', () => {
    expect(
      [...new Set(document.scenarios.map(scenario => scenario.recipe))].sort(),
    ).toEqual(document.recipes);
  });

  it('reference only fragments the catalog declares', () => {
    const declared = new Set(document.fragments.map(fragment => fragment.ref));
    const referenced = document.scenarios.flatMap(scenario =>
      scenario.stages.flatMap(stage => stage.steps.map(step => step.ref)),
    );

    expect(referenced.filter(ref => !declared.has(ref))).toEqual([]);
  });

  it('name each step once within a scenario, and guard only on an earlier wait', () => {
    for (const scenario of document.scenarios) {
      const steps = scenario.stages.flatMap(stage => stage.steps);
      expect(new Set(steps.map(step => step.step)).size).toBe(steps.length);
      for (const [index, step] of steps.entries()) {
        if (step.guard === undefined) continue;
        expect(steps.slice(0, index).map(earlier => earlier.step)).toContain(
          step.guard.wait,
        );
      }
    }
  });

  it('carry none of the placeholder values a slip pins', () => {
    expect(JSON.stringify(document.scenarios)).not.toContain('parameters');
  });
});

describe('a scenario that does not compose', () => {
  it('fails the generation, naming the scenario', () => {
    expect(() =>
      flowScenarios([{ id: 'broken', slip: () => Effect.fail('refused') }]),
    ).toThrow("docs-reference: scenario 'broken' did not compose");
  });
});

describe('reading ELK’s answer', () => {
  it('places what ELK left unplaced at the origin, with no route', () => {
    expect(
      placedFrom({ id: 'g', children: [{ id: 'a' }] }, [
        { from: 'a', to: 'b' },
      ]),
    ).toEqual({
      width: 0,
      height: 0,
      nodes: [{ step: 'a', x: 0, y: 0 }],
      edges: [{ from: 'a', to: 'b', points: [] }],
    });
  });

  it('reads a route with no bends, and a graph with no children', () => {
    expect(
      placedFrom(
        {
          id: 'g',
          width: 10.2,
          height: 20.7,
          edges: [
            {
              id: 'e0',
              sources: ['a'],
              targets: ['b'],
              sections: [
                {
                  id: 's',
                  startPoint: { x: 1.4, y: 2 },
                  endPoint: { x: 1.4, y: 9.6 },
                },
              ],
            },
          ],
        },
        [{ from: 'a', to: 'b' }],
      ),
    ).toEqual({
      width: 11,
      height: 21,
      nodes: [],
      edges: [
        {
          from: 'a',
          to: 'b',
          points: [
            [1, 2],
            [1, 10],
          ],
        },
      ],
    });
  });
});

describe('the service documents', () => {
  it('cover exactly the deployments the slice register declares', () => {
    const declared = SLICES.flatMap(slice =>
      slice.deployments.map(deployment => ({ slice: slice.name, deployment })),
    );

    expect(
      SERVICES.map(({ slice, deployment }) => ({ slice, deployment })),
    ).toEqual(
      expect.arrayContaining(
        declared.map(entry => expect.objectContaining(entry)),
      ),
    );
    expect(SERVICES).toHaveLength(declared.length);
  });

  it('describe each service as its main.ts mounts it', () => {
    for (const { slice, deployment } of SERVICES) {
      const main = readFileSync(
        join(REPO_ROOT, 'apps', deployment, 'src', 'main.ts'),
        'utf8',
      );
      expect(main, deployment).toContain(`slices: ['${slice}']`);
      expect(main, deployment).toMatch(/\bdescription: /);
      expect(main, deployment).toContain(`@r10c/shells-effect-${slice}'`);
    }
  });

  it('document every endpoint each service serves, and nothing else', () => {
    const documents = serviceDocuments();
    for (const [index, { deployment, document }] of documents.entries()) {
      const { slice, shell } = SERVICES[index];
      const served = endpointsOf(
        serviceApi({
          name: `@r10c/${deployment}`,
          slices: [slice],
          described: true,
          endpoints: shell.endpoints,
          policy: shell.policy,
        }).groups,
      );
      const documented = Object.entries(document.paths).flatMap(
        ([path, operations]) =>
          Object.keys(operations as object)
            .filter(method =>
              ['get', 'post', 'put', 'patch', 'delete'].includes(method),
            )
            .map(
              method =>
                `${method.toUpperCase()} ${path.replace(/\{([^}]+)\}/g, ':$1')}`,
            ),
      );

      expect(documented.sort(), deployment).toEqual([...served].sort());
    }
  });
});
