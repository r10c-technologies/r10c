import {
  type Entity,
  type EntityConstructor,
  type EntityId,
  makeEntityEnvelope,
  makeEntityPageEnvelope,
} from '@r10c/entifix-ts-core';
import { http, HttpResponse, type RequestHandler } from 'msw';

export interface EntityRestHandlerOptions<TEntity extends Entity> {
  /** The collection endpoint, e.g. `http://service/api/product`. */
  baseUrl: string;
  /** The rows the fake service serves. Mutated in place by writes. */
  data?: TEntity[];
}

/**
 * MSW handlers for the five REST operations the entity adapters issue, speaking
 * the real entifix envelope.
 *
 * Responses are built with `makeEntityEnvelope`/`makeEntityPageEnvelope` — the
 * production serializer — so a fixture cannot drift from the wire format the
 * adapters parse. Hand-written JSON literals in specs are exactly how that
 * drift starts.
 */
export const entityRestHandlers = <TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  { baseUrl, data = [] }: EntityRestHandlerOptions<TEntity>,
): RequestHandler[] => {
  const rows = data;

  const findById = (id: string): TEntity | undefined =>
    rows.find((row) => String(row.id) === id);

  return [
    http.get(baseUrl, ({ request }) => {
      const url = new URL(request.url);
      const page = Number(url.searchParams.get('page') ?? '1');
      const pageSize = Number(url.searchParams.get('pageSize') ?? '10');
      const start = (page - 1) * pageSize;

      return HttpResponse.json(
        makeEntityPageEnvelope(entityConstructor, {
          items: rows.slice(start, start + pageSize),
          total: rows.length,
          request: { page, pageSize },
        }),
      );
    }),

    http.get(`${baseUrl}/:id`, ({ params }) => {
      const found = findById(String(params['id']));
      return found === undefined
        ? new HttpResponse(null, { status: 404 })
        : HttpResponse.json(makeEntityEnvelope(entityConstructor, found));
    }),

    http.post(baseUrl, async ({ request }) => {
      const body = (await request.json()) as { data: Record<string, unknown> };
      // The service is what mints an id on create; echoing the request back
      // unchanged would hide that the adapter must read the response.
      const created = Object.assign(new entityConstructor(), body.data, {
        id: body.data['id'] ?? `generated-${rows.length + 1}`,
      }) as TEntity;
      rows.push(created);
      return HttpResponse.json(makeEntityEnvelope(entityConstructor, created), {
        status: 201,
      });
    }),

    http.put(`${baseUrl}/:id`, async ({ params, request }) => {
      const body = (await request.json()) as { data: Record<string, unknown> };
      const id = String(params['id']);
      const index = rows.findIndex((row) => String(row.id) === id);
      const updated = Object.assign(new entityConstructor(), body.data) as TEntity;
      if (index === -1) {
        rows.push(updated);
      } else {
        rows[index] = updated;
      }
      return HttpResponse.json(makeEntityEnvelope(entityConstructor, updated));
    }),

    // A delete answers with the removed entity's envelope rather than a bare
    // `204`: the shared fetch client always parses the response as JSON, so an
    // empty body would fail that parse — which is what the services do too.
    http.delete(`${baseUrl}/:id`, ({ params }) => {
      const id = String(params['id']);
      const index = rows.findIndex((row) => String(row.id) === id);
      const [removed] = index === -1 ? [] : rows.splice(index, 1);
      return HttpResponse.json(
        makeEntityEnvelope(
          entityConstructor,
          removed ?? (new entityConstructor() as TEntity),
        ),
      );
    }),
  ];
};

/** A single entity response, for specs that need one endpoint only. */
export const respondWithEntity = <TEntity extends Entity>(
  url: string,
  entityConstructor: EntityConstructor<TEntity>,
  instance: TEntity,
): RequestHandler =>
  http.get(url, () =>
    HttpResponse.json(makeEntityEnvelope(entityConstructor, instance)),
  );

/**
 * The failure handlers. Adapters map transport and shape failures onto
 * `EntifixError`s, and those branches are only reachable from here.
 */
export const respondWith500 = (
  url: string,
  method: 'get' | 'post' | 'put' | 'delete' = 'get',
): RequestHandler =>
  http[method](url, () => new HttpResponse(null, { status: 500 }));

export const respondWith404 = (
  url: string,
  method: 'get' | 'post' | 'put' | 'delete' = 'get',
): RequestHandler =>
  http[method](url, () => new HttpResponse(null, { status: 404 }));

/** Answers 200 with a body that is not an envelope at all. */
export const respondWithMalformedEnvelope = (
  url: string,
  method: 'get' | 'post' | 'put' | 'delete' = 'get',
  body: Record<string, unknown> = { id: 'raw', name: 'not an envelope' },
): RequestHandler => http[method](url, () => HttpResponse.json(body));

/** Answers 200 with a body that is not JSON. */
export const respondWithNonJson = (
  url: string,
  method: 'get' | 'post' | 'put' | 'delete' = 'get',
): RequestHandler =>
  http[method](url, () => new HttpResponse('<html>nope</html>', { status: 200 }));

/** Fails the request at the transport level, as a dropped connection would. */
export const respondWithNetworkError = (
  url: string,
  method: 'get' | 'post' | 'put' | 'delete' = 'get',
): RequestHandler => http[method](url, () => HttpResponse.error());

export type { RequestHandler } from 'msw';
export { http, HttpResponse } from 'msw';

/** Re-exported so `EntityId` stays available to handler authors. */
export type { EntityId };
