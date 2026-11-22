import { CAPABILITIES } from '@r10c/capabilities';

import { docsCopy, entityLabel, isSiteLocale } from '../content/copy';
import type { RelationKind } from '../content/entity-graph';
import { entityMap, type MapNode, NODE } from '../content/entity-map';
import { MAP_SCHEME } from '../content/use-cases';

/** Told apart by stroke as well as by word, never by colour. */
const DASH: Readonly<Record<RelationKind, string | undefined>> = {
  composition: undefined,
  link: undefined,
  reference: undefined,
  id: '5 4',
};

/**
 * One use case's entity map (#656), from the address its markdown gave it:
 * `/entity-map/<locale>/<capability id>`. Phrasing content only, because
 * markdown sets an image inside a paragraph.
 */
export function EntityMap({ src }: { readonly src: string }) {
  const [lang = '', id = ''] = src.slice(MAP_SCHEME.length).split('/');
  const capability = CAPABILITIES.find(entry => entry.id === id);
  if (!isSiteLocale(lang) || capability === undefined) {
    throw new Error(`docs-site: no entity map at ${src}`);
  }
  const words = docsCopy(lang).entityMap;
  const { nodes, edges, width, height } = entityMap(capability);
  const markerId = `map-${id.replaceAll(':', '-')}`;
  const titleOf = (node: MapNode) =>
    node.part ?? entityLabel(lang, node.entity);
  const middle = NODE.height / 2;

  return (
    <svg
      role="img"
      aria-label={words.description}
      viewBox={`0 0 ${width} ${height}`}
      style={{ maxWidth: width }}
      className="block h-auto w-full text-content"
    >
      <defs>
        <marker
          id={`${markerId}-arrow`}
          viewBox="0 0 10 10"
          refX="10"
          refY="5"
          markerWidth="8"
          markerHeight="8"
          orient="auto"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
        </marker>
        <marker
          id={`${markerId}-owns`}
          viewBox="0 0 12 10"
          refX="0"
          refY="5"
          markerWidth="12"
          markerHeight="10"
          orient="auto"
        >
          <path d="M 0 5 L 6 0 L 12 5 L 6 10 z" fill="currentColor" />
        </marker>
      </defs>
      {edges.map(({ kind, member, from, to }) => {
        const startX = from.x + NODE.width;
        const bendX = startX + 24;
        // The whole path: `lines.offeringId` is the line's id, not the shipment's.
        const caption = `${member} · ${words.short[kind]}`;
        const owns = kind === 'composition';
        return (
          <g key={`${from.entity} ${member}`}>
            <path
              d={`M ${startX} ${from.y + middle} L ${bendX} ${from.y + middle} L ${bendX} ${to.y + middle}`}
              fill="none"
              stroke="currentColor"
              strokeDasharray={DASH[kind]}
            />
            {/* Its own segment, so the diamond sits on the owned branch and
                never on the trunk every relation shares. */}
            <path
              d={`M ${bendX} ${to.y + middle} L ${to.x} ${to.y + middle}`}
              fill="none"
              stroke="currentColor"
              strokeDasharray={DASH[kind]}
              markerStart={owns ? `url(#${markerId}-owns)` : undefined}
              markerEnd={owns ? undefined : `url(#${markerId}-arrow)`}
            />
            <text
              x={bendX + 8}
              y={to.y + middle - 5}
              fill="currentColor"
              fontSize="11"
            >
              {caption}
            </text>
          </g>
        );
      })}
      {nodes.map(node => (
        <g key={`${node.x} ${node.y}`}>
          <rect
            x={node.x}
            y={node.y}
            width={NODE.width}
            height={NODE.height}
            rx="6"
            className="fill-surface-elevated stroke-border-control"
          />
          <text
            x={node.x + 12}
            y={node.y + 21}
            fill="currentColor"
            fontSize="13"
          >
            {titleOf(node)}
          </text>
          <text
            x={node.x + 12}
            y={node.y + 39}
            fill="currentColor"
            fontFamily="monospace"
            fontSize="11"
          >
            {node.store ?? words.noStore}
          </text>
        </g>
      ))}
    </svg>
  );
}
