import type { Capability } from '@r10c/capabilities';

import { ENTITY_GRAPH, type RelationKind } from './entity-graph';
import { storeOf } from './stores';

export const NODE = { width: 244, height: 48, gapY: 12, gapX: 200 } as const;
const MARGIN = 8;
const GROUP_GAP = 28;

export interface MapNode {
  /** `<domain>:<entityKey>`, or the owner's for a part. */
  readonly entity: string;
  /** The member path, when the node is a part an entity owns. */
  readonly part?: string;
  readonly store?: string;
  readonly x: number;
  readonly y: number;
}

export interface MapEdge {
  readonly kind: RelationKind;
  readonly member: string;
  readonly from: MapNode;
  readonly to: MapNode;
}

const storeNameOf = (entity: string) =>
  storeOf(entity.split(':')[0] ?? '')?.store.name;

/**
 * The entities one use case touches, each with what its own metadata declares
 * (#656): a row per relation, so two members naming one entity stay two arrows
 * and no arrow crosses another. Laid out at build time, so the map is static
 * SVG and needs no script.
 *
 * An entity in design has no class yet, so it is drawn with no relation.
 */
export const entityMap = (capability: Pick<Capability, 'entities'>) => {
  const nodes: MapNode[] = [];
  const edges: MapEdge[] = [];
  const right = MARGIN + NODE.width + NODE.gapX;
  let y = MARGIN;

  for (const entity of capability.entities) {
    const store = storeNameOf(entity);
    const from: MapNode = { entity, store, x: MARGIN, y };
    nodes.push(from);
    const declared = ENTITY_GRAPH.get(entity) ?? [];
    for (const [row, { member, type, target }] of declared.entries()) {
      const targetStore = target === undefined ? store : storeNameOf(target);
      const to: MapNode = {
        entity: target ?? entity,
        ...(target === undefined ? { part: member } : {}),
        store: targetStore,
        x: right,
        y: y + row * (NODE.height + NODE.gapY),
      };
      nodes.push(to);
      edges.push({
        // Whatever a member calls itself, across a store it is an id.
        kind: targetStore === store ? type : 'id',
        member,
        from,
        to,
      });
    }
    y += Math.max(declared.length, 1) * (NODE.height + NODE.gapY) + GROUP_GAP;
  }

  return {
    nodes,
    edges,
    width:
      edges.length === 0
        ? NODE.width + MARGIN * 2
        : right + NODE.width + MARGIN,
    height: y - GROUP_GAP - NODE.gapY + MARGIN,
  };
};
