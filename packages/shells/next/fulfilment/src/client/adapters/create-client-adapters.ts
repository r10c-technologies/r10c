import { EntityRepositoryTag } from '@entifix/business';
import {
  buildEntityRestAdapterDelete,
  buildEntityRestAdapterGet,
  buildEntityRestAdapterLoad,
  buildEntityRestAdapterSave,
  type BuildEntityRestOptions,
  ConfigurationClientRestClient,
  makeEntityMetadataSource,
  makeEntityRestUseCaseRunner,
} from '@entifix/rest';
import { ShippingOrder } from '@r10c/business-ts-shipping-order-management';
import { Context } from 'effect';

import type {
  CourierOption,
  FulfilmentAdapters,
  GuideOutcome,
  ShippingGuidePort,
} from '../client-types';

/**
 * fulfilment-service, reached through the host's same-origin `/api/fulfilment`
 * proxy. The address is composed from a configuration key the host rewrites to
 * its proxy path, so no port is written here.
 */
const FULFILMENT_SERVICE: BuildEntityRestOptions = {
  configuration: new ConfigurationClientRestClient(),
  uriConfig: {
    key: 'fulfilment-service-domain.[entity]',
    group: 'uri',
    extractionMode: 'compose',
  },
};

/**
 * The full REST set, although no save or delete a session can reach exists: a
 * `ShippingOrder` is opened, held and withdrawn by flows behind a crossing
 * token, and moved only by its verbs. The adapter set is the transport, not the
 * permission — what withholds Save and Delete is the served descriptor, which
 * reports the caller's real affordances. Leaving the adapters out would move
 * that decision into the browser, a second answer to a question the service
 * already answers (ADR 0026).
 */
const shippingOrderRest = Context.make(EntityRepositoryTag, {
  get: buildEntityRestAdapterGet(ShippingOrder, FULFILMENT_SERVICE),
  load: buildEntityRestAdapterLoad(ShippingOrder, FULFILMENT_SERVICE),
  save: buildEntityRestAdapterSave(ShippingOrder, FULFILMENT_SERVICE),
  delete: buildEntityRestAdapterDelete(ShippingOrder, FULFILMENT_SERVICE),
});

/**
 * The served affordance document. It decides which of `dispatch`,
 * `record-delivery`, `record-refusal` and `record-return` appear, filtered by
 * the caller's real grants and by where the shipment stands.
 */
const metadata = makeEntityMetadataSource({
  url: name => `/api/fulfilment/${name}/$metadata`,
});

/**
 * The shipment's verbs: `POST shipping-order/:id/<key>`. `dispatch` answers
 * `202` with the delivery flow to follow, and the shared optimistic path keeps
 * the verb busy until that flow's outcome is pushed (ADR 0073); a refusal is
 * decoded from its problem body.
 */
const shippingOrderUseCases = makeEntityRestUseCaseRunner(
  ShippingOrder,
  FULFILMENT_SERVICE,
);

/** A refused write's `errors` code, read off its problem body. */
const outcomeOf = async (response: Response): Promise<GuideOutcome> => {
  if (response.ok) return { ok: true };
  const body = (await response.json().catch(() => undefined)) as
    { code?: unknown } | undefined;
  return {
    ok: false,
    code: typeof body?.code === 'string' ? body.code : 'unexpected',
  };
};

/**
 * The guide verb and the courier dictionary, through the same proxy. A
 * dictionary that cannot be read is an empty one: the form then offers no
 * courier, rather than one it made up.
 */
const guide: ShippingGuidePort = {
  couriers: () =>
    fetch('/api/fulfilment/courier')
      .then(async response =>
        response.ok
          ? ((await response.json()) as { items?: CourierOption[] })
          : {},
      )
      .then(body => body.items ?? [])
      .catch(() => []),
  record: (shippingOrderId, body) =>
    fetch(
      `/api/fulfilment/shipping-order/${encodeURIComponent(shippingOrderId)}/record-guide`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // An RFC 9651 String, fresh per submit: relabelling is a new decision.
          'idempotency-key': `"${globalThis.crypto.randomUUID()}"`,
        },
        body: JSON.stringify(body),
      },
    )
      .then(outcomeOf)
      .catch((): GuideOutcome => ({ ok: false, code: 'unexpected' })),
};

export function createClientAdapters(): FulfilmentAdapters {
  return { shippingOrderRest, metadata, shippingOrderUseCases, guide };
}
