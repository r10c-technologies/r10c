import type { Plane } from '@r10c/slices';

import { projectedFrom, STORES } from './catalog';

/** The three planes, left to right, as `docs/_shared/planes.md` lists them. */
export const PLANES: readonly Plane[] = ['control', 'platform', 'tenant'];

export const BOX = { width: 236, height: 48, gapY: 12, gapX: 40 } as const;
export const HEADER = 40;
export const MARGIN = 16;

export interface PlacedStore {
  readonly name: string;
  readonly writer: string;
  readonly plane: Plane;
  readonly x: number;
  readonly y: number;
}

export interface Projection {
  readonly from: PlacedStore;
  readonly to: PlacedStore;
}

/**
 * Where each store sits: one column per plane, stores in name order down it.
 * Computed at build time from the register, so the map is static SVG and
 * needs no script to read (#657).
 */
export const storeMap = () => {
  const placed: PlacedStore[] = PLANES.flatMap((plane, column) =>
    STORES.filter(({ store }) => store.plane === plane)
      .sort((a, b) => a.store.name.localeCompare(b.store.name))
      .map(({ store, writer }, row) => ({
        name: store.name,
        writer: writer.name,
        plane,
        x: MARGIN + column * (BOX.width + BOX.gapX),
        y: MARGIN + HEADER + row * (BOX.height + BOX.gapY),
      })),
  );
  const byName = new Map(placed.map(entry => [entry.name, entry]));
  const projections: Projection[] = STORES.flatMap(({ store }) => {
    const source = projectedFrom(store);
    const from = source === undefined ? undefined : byName.get(source);
    const to = byName.get(store.name);
    return from === undefined || to === undefined ? [] : [{ from, to }];
  });
  const rows = Math.max(
    ...PLANES.map(
      plane => placed.filter(entry => entry.plane === plane).length,
    ),
  );
  return {
    placed,
    projections,
    width:
      MARGIN * 2 + PLANES.length * BOX.width + (PLANES.length - 1) * BOX.gapX,
    height: MARGIN * 2 + HEADER + rows * (BOX.height + BOX.gapY),
  };
};
