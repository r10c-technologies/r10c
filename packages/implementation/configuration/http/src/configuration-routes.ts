import type { PolicyDecisionTag } from '@entifix/authz';
import type {
  EntityRepositoryFactoryTag,
  TokenServiceTag,
} from '@entifix/business';
import {
  EntifixBuildError,
  type EntifixEnvelopeLink,
  isFailure,
  makeEntityEnvelope,
  readEntityEnvelope,
} from '@entifix/core';
import {
  type EntityRouteContext,
  type EntityRouteLinks,
  makeEntityRoutes,
  type RequestPrincipal,
  routeFailure,
} from '@entifix/service-shell';
import {
  Configuration,
  ConfigurationWriteRefused,
  ConfigurationWriterTag,
} from '@r10c/business-ts-configuration';
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http';

const KEY = 'configuration';

/** What a host provides for {@link configurationRoutes}. */
export type ConfigurationRouteServices =
  | EntityRepositoryFactoryTag
  | ConfigurationWriterTag
  | TokenServiceTag
  | PolicyDecisionTag;

/** The actor every write is audited under — from the verified principal. */
const actorOf = (context: EntityRouteContext) => {
  // The guard is `permission`: no request reaches a handler here without a
  // verified principal, so its absence is not a case to answer.
  const principal = context.principal as RequestPrincipal;
  return { userId: principal.userId, subject: principal.subject };
};

const refused = (error: ConfigurationWriteRefused) =>
  HttpServerResponse.json(
    {
      error: 'clearing the secret flag requires a new value',
      code: error.code,
    },
    { status: 400 },
  );

const invalidBody = (error: { readonly message: string }) =>
  HttpServerResponse.json(
    {
      error: 'invalid request body',
      code: 'invalidBody',
      detail: error.message,
    },
    { status: 400 },
  );

/**
 * Create or update through the audited writer. The URL is authoritative on
 * update, so a row cannot be re-pointed by editing its payload.
 */
const save =
  (verb: 'create' | 'update') =>
  (context: EntityRouteContext, links: EntityRouteLinks) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const incoming = yield* readEntityEnvelope(
        Configuration,
        yield* request.json,
      );
      if (verb === 'update') {
        incoming.id = (yield* HttpRouter.params).id;
      }
      const writer = yield* ConfigurationWriterTag;
      const saved = yield* writer.save(incoming, actorOf(context));
      return yield* HttpServerResponse.json(
        makeEntityEnvelope(Configuration, saved, links.record(saved.id)),
      );
    }).pipe(
      Effect.catch(error =>
        error instanceof ConfigurationWriteRefused
          ? refused(error)
          : error instanceof EntifixBuildError ||
              (isFailure(error) && error.category === 'invalid')
            ? invalidBody(error)
            : routeFailure(error),
      ),
    );

/**
 * Delete through the audited writer. Answers an envelope rather than a bare
 * `204`: the entifix fetch client parses every response as JSON.
 */
const remove = (context: EntityRouteContext, links: EntityRouteLinks) =>
  Effect.gen(function* () {
    const { id } = yield* HttpRouter.params;
    const writer = yield* ConfigurationWriterTag;
    // The route is `/:id`, so the parameter is always there.
    const deleted = yield* writer.delete(id as string, actorOf(context));
    if (!deleted) {
      return yield* HttpServerResponse.json(
        { message: 'not found', code: 'notFound', entity: KEY },
        { status: 404 },
      );
    }
    const collection: EntifixEnvelopeLink[] = links.collection();
    return yield* HttpServerResponse.json({
      meta: { type: 'entity', entity: KEY, links: collection },
      data: { id },
    });
  }).pipe(Effect.catch(routeFailure));

/**
 * The configuration CRUD, behind `config:configuration:*`.
 *
 * The reads are the generic ones — the store's repository blanks every
 * secret, so nothing here has to remember to. The writes are this cell's own,
 * because each is two facts that commit together: the row and an audit entry
 * naming who acted. Writes are a plain save rather than the saga path: there
 * is no cross-service invariant to coordinate, and an operator editing a
 * connection string wants a synchronous answer.
 */
export const configurationRoutes = makeEntityRoutes(Configuration, {
  verbs: ['list', 'get', 'create', 'update', 'delete'],
  guard: { kind: 'permission' },
  override: { create: save('create'), update: save('update'), delete: remove },
});
