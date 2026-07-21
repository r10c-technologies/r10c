import type { ConfigurationPlain } from '@r10c/entifix-ts-core';
import type { Entity, EntityConstructor } from '@r10c/entifix-ts-core';
import { http, HttpResponse, type RequestHandler } from 'msw';

import {
  type BackendResponse,
  type EntityBackend,
  type EntityBackendOptions,
  makeEntityBackend,
} from './entity-backend';

export interface EntityBackendHandlerOptions extends EntityBackendOptions {
  /** The collection endpoint, e.g. `http://localhost:3101/api/product-brand`. */
  baseUrl: string;
}

/**
 * Puts an {@link makeEntityBackend} behind msw handlers, so a browser under
 * Playwright talks to the real query pipeline over the real wire format.
 *
 * The backend is returned alongside the handlers because a spec usually wants
 * both: the handlers to install, and the backend to reseed or to break with
 * `backend.db.failWith(...)`.
 */
export const entityBackendHandlers = <TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  { baseUrl, ...options }: EntityBackendHandlerOptions,
): { handlers: RequestHandler[]; backend: EntityBackend } => {
  const backend = makeEntityBackend(entityConstructor, options);

  // Every body is an envelope or an error record — JSON either way. The cast is
  // the one place the backend's transport-free `unknown` meets msw's body type.
  const respond = ({ status, body }: BackendResponse) =>
    HttpResponse.json(body as Record<string, unknown>, { status });

  return {
    backend,
    handlers: [
      http.get(baseUrl, async ({ request }) =>
        respond(await backend.list(new URL(request.url).searchParams)),
      ),
      http.get(`${baseUrl}/:id`, async ({ params }) =>
        respond(await backend.get(String(params['id']))),
      ),
    ],
  };
};

/**
 * The configuration lookup every entifix frontend makes before it can issue a
 * single entity request: the REST adapters resolve their base URL through it.
 *
 * Stubbing the entity endpoint without this one leaves the page waiting
 * forever and the spec passing vacuously, so it is a first-class fixture rather
 * than something each suite remembers to add.
 */
export const configurationHandler = (
  url: string,
  configuration: ConfigurationPlain,
): RequestHandler => http.get(url, () => HttpResponse.json(configuration));

export type { RequestHandler } from 'msw';
export { http, HttpResponse } from 'msw';
