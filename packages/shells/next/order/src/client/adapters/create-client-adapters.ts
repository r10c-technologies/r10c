import { EntityRepositoryTag } from '@entifix/business';
import { Entity, EntityConstructor } from '@entifix/core';
import {
  buildEntityRestAdapterDelete,
  buildEntityRestAdapterGet,
  buildEntityRestAdapterLoad,
  buildEntityRestAdapterSave,
  BuildEntityRestOptions,
  ConfigurationClientRestClient,
  makeEntityMetadataSource,
  makeEntityRestUseCaseRunner,
} from '@entifix/rest';
import { ProductOrder } from '@r10c/business-ts-order-management';
import { Context } from 'effect';

import type {
  OrderAdapters,
  PaymentLinkOutcome,
  PaymentLinkPort,
  PaymentLinkProviderOption,
} from '../client-types';

/**
 * Where every adapter below resolves its URL, bound when each is built — the
 * host's `/api/config`, so the lookup is same-origin and carries the session.
 */
const configuration = new ConfigurationClientRestClient();

/**
 * order-service, reached through the host's same-origin `/api/order` proxy.
 *
 * The address is composed from a configuration key rather than written here: the
 * app rewrites the domain to its proxy path before the browser sees it, so a
 * literal would be the one place still holding the real port.
 */
const ORDER_SERVICE: BuildEntityRestOptions = {
  configuration,
  uriConfig: {
    key: 'order-service-domain.[entity]',
    group: 'uri',
    extractionMode: 'compose',
  },
};

/**
 * Builds the full CRUD adapter set for one entity, backed by REST, under the
 * shared {@link EntityRepositoryTag}.
 *
 * ⚠️ `save` and `delete` are built although **neither has a route a browser can
 * reach**: order-service's writes take a crossing token and no session, and the
 * host's proxy forwards `GET` only. The adapter set is the transport, not the
 * permission — what withholds Save is the *served* descriptor, which reports the
 * caller's real affordances. Omitting the adapters instead would move that
 * decision into the browser, where it would be a second answer to a question the
 * service already answers ([ADR 0026](../../../../../../../docs/adr/0026-the-use-case-descriptor-and-served-entity-metadata.md)).
 */
function createRestRepositoryContext<TEntity extends Entity>(
  entityConstructor: EntityConstructor<TEntity>,
) {
  return Context.make(EntityRepositoryTag, {
    get: buildEntityRestAdapterGet(entityConstructor, ORDER_SERVICE),
    load: buildEntityRestAdapterLoad(entityConstructor, ORDER_SERVICE),
    save: buildEntityRestAdapterSave(entityConstructor, ORDER_SERVICE),
    delete: buildEntityRestAdapterDelete(entityConstructor, ORDER_SERVICE),
  });
}

const productOrderRest = createRestRepositoryContext(ProductOrder);

/**
 * The served affordance document, through the host's same-origin proxy.
 *
 * ⚠️ It is what decides whether this screen shows a Save at all. No role holds
 * `order-management:product-order:write`, so `$metadata` withholds the verb and
 * the form renders read-only — without this shell asserting anything about it
 * ([ADR 0026](../../../../../../../docs/adr/0026-the-use-case-descriptor-and-served-entity-metadata.md)).
 *
 * It is also what decides whether `cancel` appears: the document is filtered
 * by the caller's real grants, so a `user` does not see it and no client-side
 * check is needed or wanted.
 */
const metadata = makeEntityMetadataSource({
  url: name => `/api/order/${name}/$metadata`,
});

/**
 * The order's verb — `cancel` — through the same proxy and `uri`
 * composition as the repository: `POST product-order/:id/<key>`, the path the
 * service derives from each `@useCase()`, with a refusal decoded from its
 * problem body.
 */
const productOrderUseCases = makeEntityRestUseCaseRunner(
  ProductOrder,
  ORDER_SERVICE,
);

/** The `errors` code a refusal's problem body names, or `unexpected`. */
const refusalOf = async (response: Response): Promise<PaymentLinkOutcome> => {
  if (response.ok) return { ok: true };
  const body = (await response.json().catch(() => undefined)) as
    | { code?: unknown }
    | undefined;
  return {
    ok: false,
    code: typeof body?.code === 'string' ? body.code : 'unexpected',
  };
};

/** One verb on one order, posted through the proxy with its body. */
const postVerb = (orderId: string, verb: string, body: unknown) =>
  fetch(
    `/api/order/product-order/${encodeURIComponent(orderId)}/${verb}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // An RFC 9651 String, fresh per submit: a retried click is a new
        // decision, and the order's status refuses a second confirmation.
        'idempotency-key': `"${globalThis.crypto.randomUUID()}"`,
      },
      body: JSON.stringify(body),
    },
  )
    .then(refusalOf)
    .catch((): PaymentLinkOutcome => ({ ok: false, code: 'unexpected' }));

/**
 * A payment-link order's verbs and its provider dictionary, through the same
 * proxy. A dictionary that cannot be read is an empty one: the form then has
 * no provider to offer, rather than one it made up.
 */
const paymentLink: PaymentLinkPort = {
  providers: () =>
    fetch('/api/order/payment-link-provider')
      .then(async response =>
        response.ok
          ? ((await response.json()) as {
              items?: PaymentLinkProviderOption[];
            })
          : {},
      )
      .then(body => body.items ?? [])
      .catch(() => []),
  setLink: (orderId, body) => postVerb(orderId, 'set-payment-link', body),
  confirm: (orderId, body) => postVerb(orderId, 'confirm-payment', body),
};

export function createClientAdapters(): OrderAdapters {
  return { productOrderRest, metadata, productOrderUseCases, paymentLink };
}
