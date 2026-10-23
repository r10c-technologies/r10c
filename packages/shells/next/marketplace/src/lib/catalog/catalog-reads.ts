import { EntityRepositoryTag } from '@entifix/business';
import type {
  EntifixError,
  Entity,
  EntityConstructor,
  EntityPage,
} from '@entifix/core';
import {
  buildEntityRestAdapterDelete,
  buildEntityRestAdapterGet,
  buildEntityRestAdapterLoad,
  buildEntityRestAdapterSave,
  type BuildEntityRestOptions,
  ConfigurationClientRestClient,
} from '@entifix/rest';
import { configSourceFor } from '@r10c/utils-ts-fleet';
import { Cause, Context, Effect } from 'effect';

/**
 * The storefront's composition of its catalog reads, against marketplace-service.
 *
 * The reads themselves live in the cells — `marketplace-catalog/next` for the
 * projection, `catalog-reference/next` for the browse vocabulary — and require
 * nothing but a repository. This module is the only place the storefront names
 * the transport that answers them, which is the whole of what a shell is for
 * (ADR 0060). Both stores are marketplace-service's, so there is one backend and
 * one configuration key.
 *
 * ⚠️ **No proxy, and none is wanted.** `rewriteServiceDomains` exists so a real
 * backend address never reaches a browser; nothing here reaches a browser, so
 * the storefront talks to the service base URL directly. Reads there are
 * unauthenticated by design — the storefront must never hold a session to show
 * a catalog.
 */

/**
 * The one backend, composed per entity from its `@entity({ key })`.
 *
 * The same shape marketplace-admin's `create-client-adapters.ts` uses; the
 * difference is the value behind the key, which config-service supplies per
 * app.
 */
const MARKETPLACE_SERVICE: Omit<BuildEntityRestOptions, 'configuration'> = {
  uriConfig: {
    key: 'marketplace-service-domain.[entity]',
    group: 'uri',
    extractionMode: 'compose',
  },
};

/**
 * The full adapter set for one entity.
 *
 * `save` and `delete` are built even though the storefront never calls them:
 * `EntityRepositoryTag` is one tag with four members, and stubbing two of them
 * to a failure would be a second contract to keep in step with the real one for
 * no gain. Nothing here can write anyway — `published-catalog` is a projection
 * with a single writer, and marketplace-service registers no POST for it.
 */
const repositoryFor = <TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
  options: BuildEntityRestOptions,
) =>
  Context.make(EntityRepositoryTag, {
    get: buildEntityRestAdapterGet(entityConstructor, options),
    load: buildEntityRestAdapterLoad(entityConstructor, options),
    save: buildEntityRestAdapterSave(entityConstructor, options),
    delete: buildEntityRestAdapterDelete(entityConstructor, options),
  });

/** A page with nothing on it — what a failed list read renders. */
export const emptyPage = <TEntity extends Entity>(): EntityPage<TEntity> => ({
  items: [],
  total: 0,
  request: {},
});

/**
 * A runner for cell reads: each one runs over the REST repository for the
 * entity it names, and **never rejects**.
 *
 * The entity is named here, not inferred, because a read requires *a*
 * repository and the REST adapter is built per entity; each cell function says
 * which entity it reads.
 *
 * Never rejecting has two reasons, and the second is the one that matters.
 * `next build` prerenders the home page per locale, and a build machine has no
 * fleet — a throw here would make the build depend on a running backend. And a
 * storefront that answers `500` because one backend blinked is worse than one
 * that renders its own "nothing here yet" copy over an intact page.
 *
 * ⚠️ The cost is real and is accepted rather than hidden: **an empty catalog
 * and a broken backend render identically.** The log is the only thing that
 * tells them apart, which is why this must not spread to anything that writes.
 * `catchCause` rather than `catch` so a defect is caught too — a defect
 * escaping into a prerender fails the build just as loudly as a failure.
 */
export const makeRunRead = () => {
  /**
   * Where the URL for the key above comes from.
   *
   * ⚠️ Read **directly from config-service**, with the shared fleet token, rather
   * than from this app's own `/api/config`: a relative URL has no origin to
   * resolve against under Node, and an app fetching its own route while
   * prerendering itself is a request that cannot be served. That endpoint is
   * gated because it serves real connection strings, so the header is not
   * optional — this is the same lookup `createConfigRoute` and the readiness
   * probe already make, minus the browser they exist to protect.
   *
   * One instance, so the lookup is memoized for the life of the process. A
   * changed URI therefore needs a restart, exactly as it does in the browser.
   */
  const options: BuildEntityRestOptions = {
    ...MARKETPLACE_SERVICE,
    configuration: new ConfigurationClientRestClient(
      configSourceFor('marketplace-app'),
    ),
  };

  return <A, TEntity extends Entity>(
    entityConstructor: EntityConstructor<TEntity>,
    read: Effect.Effect<A, EntifixError, EntityRepositoryTag>,
    fallback: A,
  ): Promise<A> =>
    Effect.runPromise(
      read.pipe(
        Effect.provide(repositoryFor(entityConstructor, options)),
        Effect.catchCause(cause =>
          Effect.sync(() => {
            console.error(
              `The storefront could not read ${entityConstructor.name}: ${Cause.pretty(cause)}`,
            );
            return fallback;
          }),
        ),
      ),
    );
};

/**
 * The storefront's one runner, so the configuration lookup is shared and
 * memoized for the life of the process.
 */
export const runRead = makeRunRead();
