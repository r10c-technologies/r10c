import {
  DocsBody,
  DocsDescription,
  DocsPage as FumadocsPage,
  DocsTitle,
} from 'fumadocs-ui/page';
import { notFound } from 'next/navigation';

import { docsCopy, isSiteLocale } from '../../../content/copy';
import { href } from '../../../content/markdown';
import {
  BOX,
  MARGIN,
  type PlacedStore,
  PLANES,
  storeMap,
} from '../../../content/store-map';

interface Props {
  readonly params: Promise<{ lang: string }>;
}

const resolve = async ({ params }: Props) => {
  const { lang } = await params;
  if (!isSiteLocale(lang)) notFound();
  return lang;
};

export async function generateMetadata(props: Props) {
  const copy = docsCopy(await resolve(props)).catalog;
  return { title: copy.map, description: copy.mapDescription };
}

/** The point an arrow leaves from or arrives at: the facing edge's middle. */
const edge = (store: PlacedStore, other: PlacedStore) => {
  const middle = store.y + BOX.height / 2;
  if (store.x === other.x) return { x: store.x + BOX.width, y: middle };
  return { x: store.x < other.x ? store.x + BOX.width : store.x, y: middle };
};

/**
 * Every store by plane, each with the one slice that writes it, and an arrow
 * from each store a projection is built from (#657). Static SVG, laid out at
 * build time; the stores page carries the same facts as a table.
 */
export default async function StoreMap(props: Props) {
  const lang = await resolve(props);
  const copy = docsCopy(lang).catalog;
  const { placed, projections, width, height } = storeMap();
  return (
    <FumadocsPage full>
      <div data-pagefind-body="">
        <DocsTitle>{copy.map}</DocsTitle>
        <DocsDescription>{copy.mapDescription}</DocsDescription>
        <DocsBody>
          <div className="overflow-x-auto">
            <svg
              role="img"
              aria-labelledby="store-map-title"
              viewBox={`0 0 ${width} ${height}`}
              className="h-auto w-full text-content"
            >
              <title id="store-map-title">{copy.mapDescription}</title>
              <defs>
                <marker
                  id="arrow"
                  viewBox="0 0 10 10"
                  refX="10"
                  refY="5"
                  markerWidth="8"
                  markerHeight="8"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
                </marker>
              </defs>
              {PLANES.map((plane, column) => (
                <text
                  key={plane}
                  x={MARGIN + column * (BOX.width + BOX.gapX)}
                  y={MARGIN + 20}
                  fill="currentColor"
                  fontWeight="600"
                >
                  {copy.planes[plane]}
                </text>
              ))}
              {projections.map(({ from, to }) => {
                const start = edge(from, to);
                const end = edge(to, from);
                const caption = `${copy.projectionOf} ${from.name}`;
                const path =
                  from.x === to.x
                    ? `M ${start.x} ${start.y} C ${start.x + 48} ${start.y}, ${end.x + 48} ${end.y}, ${end.x} ${end.y}`
                    : `M ${start.x} ${start.y} L ${end.x} ${end.y}`;
                return (
                  <path
                    key={`${from.name}-${to.name}`}
                    d={path}
                    fill="none"
                    stroke="currentColor"
                    strokeDasharray="4 3"
                    markerEnd="url(#arrow)"
                  >
                    <title>{caption}</title>
                  </path>
                );
              })}
              {placed.map(store => {
                const writer = `${copy.writer}: ${store.writer}`;
                return (
                  <a
                    key={store.name}
                    href={href(lang, 'stores', store.name)}
                    className="no-underline"
                  >
                    <rect
                      x={store.x}
                      y={store.y}
                      width={BOX.width}
                      height={BOX.height}
                      rx="6"
                      className="fill-surface-elevated stroke-border-control"
                    />
                    <text
                      x={store.x + 12}
                      y={store.y + 22}
                      fill="currentColor"
                      fontFamily="monospace"
                      fontSize="13"
                    >
                      {store.name}
                    </text>
                    <text
                      x={store.x + 12}
                      y={store.y + 40}
                      fill="currentColor"
                      fontSize="11"
                    >
                      {writer}
                    </text>
                  </a>
                );
              })}
            </svg>
          </div>
        </DocsBody>
      </div>
    </FumadocsPage>
  );
}
