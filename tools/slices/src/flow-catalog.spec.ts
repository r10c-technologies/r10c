import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SLICES } from './registry.js';
import type { SliceDeclaration } from './types.js';

/**
 * The fragment catalog's committed snapshot (ADR 0065). Read as JSON rather
 * than imported, so the register checks the calls a flow makes without
 * depending on the packages that declare them.
 */
const SNAPSHOT = join(
  import.meta.dirname,
  '../../../packages/shells/effect/flow-catalog/catalog-snapshot.json',
);

interface Call {
  readonly method: string;
  readonly path: string;
}
interface SnapshotFragment {
  readonly ref: string;
  readonly participant?: string;
  readonly call?: Call;
  readonly compensation?: Call;
}

const fragments = (
  JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as {
    fragments: readonly SnapshotFragment[];
  }
).fragments;

/** Whether `apis` — `GET|POST /api/x` entries — names `call`. */
const names = (apis: readonly string[], call: Call) =>
  apis.some(api => {
    const [methods, path] = api.split(' ');
    return (
      path === call.path && (methods ?? '').split('|').includes(call.method)
    );
  });

/** Every call a fragment makes that the register does not declare on both ends. */
export const undeclaredCalls = (
  slices: readonly SliceDeclaration[],
  catalog: readonly SnapshotFragment[],
): string[] => {
  const coordinator = slices.find(slice => slice.name === 'transaction');
  return catalog.flatMap(fragment => {
    if (fragment.participant === undefined) return [];
    const owner = slices.find(slice =>
      slice.deployments.includes(fragment.participant as string),
    );
    return [fragment.call, fragment.compensation]
      .filter((call): call is Call => call !== undefined)
      .flatMap(call => {
        const what = `${fragment.ref} ${call.method} ${call.path}`;
        return [
          ...(owner !== undefined && names(owner.exposedAPIs, call)
            ? []
            : [`${what}: not exposed by ${fragment.participant}`]),
          ...(coordinator !== undefined &&
          names(coordinator.dependantAPIs, call)
            ? []
            : [`${what}: not in the transaction slice's dependantAPIs`]),
        ];
      });
  });
};

describe('Every call a flow makes is declared on both ends (ADR 0065)', () => {
  it('finds the fragments it is meant to check', () => {
    expect(fragments.length).toBeGreaterThanOrEqual(9);
  });

  it("finds every fragment's call exposed and depended on", () => {
    expect(undeclaredCalls(SLICES, fragments)).toEqual([]);
  });

  it('catches a call the participant does not expose (planted)', () => {
    const planted = SLICES.map(slice =>
      slice.name === 'stock'
        ? {
            ...slice,
            exposedAPIs: slice.exposedAPIs.filter(
              api => api !== 'POST /api/stock-restoration',
            ),
          }
        : slice,
    );

    expect(undeclaredCalls(planted, fragments)).toEqual([
      'stock.restore@1 POST /api/stock-restoration: not exposed by stock-service',
    ]);
  });
});
