import {
  defineEntityApi,
  type EntityApiContext,
  type EntityApiRequest,
  type RequestPrincipal,
} from '@entifix/business';
import {
  entityKey,
  makeEntityEnvelope,
  NotFound,
  readEntityEnvelope,
} from '@entifix/core';
import {
  Configuration,
  ConfigurationWriteRefused,
  ConfigurationWriterTag,
} from '@r10c/business-ts-configuration';
import { Effect } from 'effect';

const KEY = entityKey(Configuration, 'configuration');

/** The actor every write is audited under — from the verified principal. */
const actorOf = (context: EntityApiContext) => {
  // The guard is `permission`: no request reaches a handler here without a
  // verified principal, so its absence is not a case to answer.
  const principal = context.principal as RequestPrincipal;
  return { userId: principal.userId, subject: principal.subject };
};

/**
 * Create or update through the audited writer. The URL is authoritative on
 * update, so a row cannot be re-pointed by editing its payload.
 */
const save =
  (verb: 'create' | 'update') =>
  (request: EntityApiRequest, context: EntityApiContext) =>
    Effect.gen(function* () {
      const incoming = yield* readEntityEnvelope(
        Configuration,
        request.payload,
      );
      // The route is `/:id` for an update, so the parameter is always there.
      if (verb === 'update') incoming.id = request.params?.id as string;
      const writer = yield* ConfigurationWriterTag;
      const saved = yield* writer.save(incoming, actorOf(context));
      return makeEntityEnvelope(
        Configuration,
        saved,
        context.links.record(saved.id),
      );
    });

/**
 * Delete through the audited writer. Answers an envelope rather than a bare
 * `204`: the entifix fetch client parses every response as JSON.
 */
const remove = (request: EntityApiRequest, context: EntityApiContext) =>
  Effect.gen(function* () {
    const id = request.params?.id as string;
    const writer = yield* ConfigurationWriterTag;
    if (!(yield* writer.delete(id, actorOf(context))))
      return yield* Effect.fail(new NotFound({ entity: KEY }));
    return {
      meta: { type: 'entity', entity: KEY, links: context.links.collection() },
      data: { id },
    };
  });

/**
 * The configuration CRUD, behind `config:configuration:*`
 * ([ADR 0071](../../../../../docs/adr/0071-http-cells-hold-descriptors-and-the-slice-shell-builds-the-api.md)).
 *
 * The reads are the generic ones — the store's repository blanks every
 * secret, so nothing here has to remember to. The writes are this cell's own,
 * because each is two facts that commit together: the row and an audit entry
 * naming who acted. Writes are a plain save rather than a flow: there is no
 * cross-service invariant to coordinate, and an operator editing a connection
 * string wants a synchronous answer.
 */
export const configurationApi = defineEntityApi(Configuration, KEY, {
  verbs: ['list', 'get', 'create', 'update', 'delete'],
  guard: { kind: 'permission' },
  override: {
    create: { errors: [ConfigurationWriteRefused], handler: save('create') },
    update: { errors: [ConfigurationWriteRefused], handler: save('update') },
    delete: { errors: [NotFound], handler: remove },
  },
});
