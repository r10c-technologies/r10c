import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from '@effect/platform';
import {
  SalesChannel,
  SELL_AT_CHANNEL,
  SellAtChannelUC,
} from '@r10c/business-ts-sales-management';
import {
  EntityIdTag,
  EntityRepositoryTag,
  getUCFactory,
} from '@r10c/entifix-ts-business';
import { makeEnvelope } from '@r10c/entifix-ts-core';
import {
  makeMongoRepository,
  MongoDatabaseTag,
} from '@r10c/entifix-ts-mongo-client';
import { requireOrganization } from '@r10c/shells-effect-service';
import { Effect } from 'effect';

import {
  CheckoutCoordinatorUrl,
  CheckoutCrossingToken,
  PublishedCatalogUrl,
} from '../counter-sale-config';
import { serverError, withTenantDatabase } from './entity-crud';

/** The crossing header the coordinator's own guard reads. */
const CROSSING_TOKEN_HEADER = 'x-crossing-token';

/** What a seller sends: a channel, some lines, and how the money arrived. */
interface CounterSaleRequest {
  readonly channelId: string;
  readonly lines: ReadonlyArray<{
    readonly offeringId: string;
    readonly quantity: number;
  }>;
  readonly paymentMethod: string;
}

/** One line as the saga needs it, priced here rather than by the caller. */
interface PricedLine {
  readonly offeringId: string;
  readonly vendorId: string;
  readonly quantity: number;
  readonly amount: number;
  readonly currency: string;
}

const badRequest = (detail: string) =>
  HttpServerResponse.json(
    { error: 'invalid request body', code: 'invalidBody', detail },
    { status: 400 },
  );

const readRequest = (body: unknown): CounterSaleRequest | undefined => {
  if (typeof body !== 'object' || body === null) return undefined;
  const { channelId, lines, paymentMethod } = body as Record<string, unknown>;
  if (typeof channelId !== 'string' || channelId.length === 0) return undefined;
  if (typeof paymentMethod !== 'string' || paymentMethod.length === 0) {
    return undefined;
  }
  if (!Array.isArray(lines) || lines.length === 0) return undefined;
  const parsed = lines.map(line => {
    if (typeof line !== 'object' || line === null) return undefined;
    const { offeringId, quantity } = line as Record<string, unknown>;
    return typeof offeringId === 'string' &&
      typeof quantity === 'number' &&
      Number.isInteger(quantity) &&
      quantity > 0
      ? { offeringId, quantity }
      : undefined;
  });
  return parsed.every(line => line !== undefined)
    ? { channelId, lines: parsed as PricedLine[], paymentMethod }
    : undefined;
};

/**
 * The published offering a line names, read from the projection.
 *
 * ⚠️ **The price comes from here and never from the request.** A browser that
 * could send an amount could sell a vendor's goods for nothing, and this route
 * presents a crossing token on the caller's behalf — so the one input that must
 * not be caller-controlled is the money. It is the same rule the storefront
 * applies by pricing in a server action from what the buyer was shown; at a
 * counter what the buyer was shown is what the vendor published.
 *
 * The read is anonymous because the projection is: `published-catalog` is
 * platform plane and the storefront serves it to nobody in particular.
 */
const publishedOffering = (baseUrl: string, offeringId: string) =>
  Effect.tryPromise({
    try: async () => {
      const query = encodeURIComponent(`offeringId==${offeringId}`);
      const response = await fetch(
        `${baseUrl}/published-offering?rsql=${query}&pageSize=1`,
      );
      if (!response.ok) return undefined;
      const payload = (await response.json()) as {
        data?: { items?: ReadonlyArray<Record<string, unknown>> };
      };
      return payload.data?.items?.[0];
    },
    catch: error => error,
  });

/**
 * Ring up a sale at a vendor's own counter.
 *
 * ⚠️ **This service does not write the sale, and that is the design.** TM Forum
 * models an in-store sale as a channel on the same `ProductOrder`, so a counter
 * sale is the *checkout saga* with a channel on its order — the same reserve,
 * write, capture and convert the storefront runs
 * ([ADR 0024](../../../../docs/adr/0024-selling-through-a-vendors-own-channel.md),
 * [ADR 0056](../../../../docs/adr/0056-the-counter-sale-is-the-checkout-saga.md)).
 * Building a second path into stock and settlement would have split a vendor's
 * takings, their returns and their buyer's history in two.
 *
 * Four things happen before the flow starts, in this order, and the order is
 * what makes the last one safe:
 *
 * 1. `requireOrganization(SELL_AT_CHANNEL)` — a verified principal, an active
 *    organization, and the verb. A session is the only credential this route
 *    accepts.
 * 2. The channel is loaded from the **caller's own** tenant handle, so a channel
 *    id belonging to another vendor resolves to nothing rather than to their
 *    record. `SellAtChannelUC.run` then refuses a retired one.
 * 3. Every line is re-priced from the published projection and refused unless
 *    its `vendorId` is the caller's organization — a seller may sell their own
 *    goods and nobody else's.
 * 4. Only then is the coordinator's crossing token presented.
 *
 * The answer mirrors the coordinator's: `201` with the order, `409` when a line
 * could not be held and every hold taken was given back, `500` when something
 * is actually wrong.
 */
const counterSaleRoute = (organizationId: string) =>
  Effect.gen(function* () {
    const coordinatorUrl = yield* CheckoutCoordinatorUrl;
    const crossingToken = yield* CheckoutCrossingToken;
    const catalogUrl = yield* PublishedCatalogUrl;
    const db = yield* MongoDatabaseTag;

    const request = yield* HttpServerRequest.HttpServerRequest;
    const sale = readRequest(yield* request.json);
    if (!sale) {
      return yield* badRequest(
        'a counter sale needs a channelId, a paymentMethod and at least one line of a positive whole quantity',
      );
    }

    const channel = yield* getUCFactory<SalesChannel>().pipe(
      Effect.provideService(
        EntityRepositoryTag,
        makeMongoRepository(db, SalesChannel),
      ),
      Effect.provideService(EntityIdTag, sale.channelId),
      // A channel this organization does not have. Not found rather than
      // forbidden: the id is the store's primary key, and a 403 would make the
      // route an oracle for which channels exist elsewhere.
      Effect.catchAll(() => Effect.succeed(undefined)),
    );
    if (channel === undefined) {
      return yield* HttpServerResponse.json(
        { error: 'no such sales channel', code: 'notFound' },
        { status: 404 },
      );
    }

    const active = yield* Effect.try({
      try: () => SellAtChannelUC.run(channel),
      catch: () => undefined,
    }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    if (active === undefined) {
      return yield* HttpServerResponse.json(
        {
          error: 'that channel is retired',
          code: 'channelInactive',
          detail: 'A retired sales channel cannot take a sale',
        },
        { status: 409 },
      );
    }

    const priced: PricedLine[] = [];
    for (const line of sale.lines) {
      const offering = yield* publishedOffering(catalogUrl, line.offeringId);
      const vendorId = offering?.['vendorId'];
      const amount = offering?.['amount'];
      const currency = offering?.['currency'];
      if (
        typeof vendorId !== 'string' ||
        typeof amount !== 'number' ||
        typeof currency !== 'string'
      ) {
        return yield* badRequest(
          `nothing published answers to the offering "${line.offeringId}"`,
        );
      }
      if (vendorId !== organizationId) {
        // A seller may sell their own goods and nobody else's. The check is
        // here rather than on the reserve, because by then this process has
        // already presented a token that can name any organization.
        return yield* HttpServerResponse.json(
          {
            error: 'that offering belongs to another vendor',
            code: 'notYours',
            detail: `The offering "${line.offeringId}" is not this organization's to sell`,
          },
          { status: 403 },
        );
      }
      priced.push({
        offeringId: line.offeringId,
        vendorId,
        quantity: line.quantity,
        amount,
        currency,
      });
    }

    const total = priced.reduce(
      (accumulated, line) => ({
        amount: accumulated.amount + line.amount * line.quantity,
        currency: line.currency,
      }),
      { amount: 0, currency: priced[0]?.currency ?? 'GTQ' },
    );

    const response = yield* Effect.tryPromise({
      try: () =>
        fetch(`${coordinatorUrl}/saga/checkout`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            [CROSSING_TOKEN_HEADER]: crossingToken,
          },
          body: JSON.stringify({
            inputs: {
              reserve: priced.map(line => ({
                organizationId: line.vendorId,
                body: {
                  meta: { type: 'entity', entity: 'reservation' },
                  data: { offeringId: line.offeringId, quantity: line.quantity },
                },
              })),
              'write-order': [
                {
                  body: {
                    meta: { type: 'entity', entity: 'product-order' },
                    data: {
                      items: priced,
                      // ⚠️ No `buyerId`. A walk-in at a counter has no account,
                      // and an absent buyer is honest — `channel` is what
                      // explains it (ADR 0024).
                      channel: {
                        id: String(channel.id),
                        // Copied, never linked: the buyer reading this receipt
                        // holds no tenant handle and could not dereference a
                        // pointer into this store at all. The copy is taken now
                        // and never refreshed, so renaming a channel does not
                        // rewrite history.
                        name: channel.name,
                        type: channel.type,
                      },
                    },
                  },
                },
              ],
              'capture-payment': [
                {
                  body: {
                    meta: { type: 'entity', entity: 'payment' },
                    data: {
                      // ⚠️ A **template**, not a placeholder this code fills in:
                      // order-service mints the id, so it does not exist yet.
                      // The engine resolves it from the step's recorded outcome
                      // before dispatching the capture.
                      orderId: '{steps.write-order.data.id}',
                      amount: total.amount,
                      currency: total.currency,
                      paymentMethod: sale.paymentMethod,
                      // A bare id here, unlike the order's copy: a payment is
                      // read by the vendor and by settlement, both of which can
                      // resolve the channel in the store that owns it.
                      channelId: String(channel.id),
                    },
                  },
                },
              ],
              // `convert-reservation` deliberately takes no input: its
              // cardinality and its addresses come from the holds `reserve`
              // actually took.
            },
          }),
        }),
      catch: error => error,
    });

    const payload = yield* Effect.tryPromise({
      try: () => response.json() as Promise<unknown>,
      catch: error => error,
    }).pipe(Effect.catchAll(() => Effect.succeed(undefined)));

    if (response.status === 201) {
      return yield* HttpServerResponse.json(
        makeEnvelope('sagaResult', 'counter-sale', payload),
        { status: 201 },
      );
    }
    if (response.status === 409) {
      // The saga's own answer for "compensated": a line was refused and every
      // hold taken has been given back. A stock outcome the seller can act on,
      // not an error to apologise for.
      return yield* HttpServerResponse.json(
        {
          error: 'the sale could not be completed',
          code: 'unavailable',
          detail: 'A line could not be held, and every hold taken was released',
        },
        { status: 409 },
      );
    }
    return yield* serverError(
      `the checkout coordinator answered ${response.status}`,
    );
  }).pipe(Effect.catchAll(serverError));

/**
 * `POST /api/counter-sale` — the till's one write.
 *
 * It is mounted on `requireOrganization` directly rather than on `guarded`,
 * because the permission is a **verb** rather than a shape of `write` on the
 * entity: `permissionForEntity(SalesChannel, 'write')` would let anyone who can
 * rename a channel sell through it, and the two are not the same authority.
 */
export const counterSaleRoutes = <E, R>(router: HttpRouter.HttpRouter<E, R>) =>
  router.pipe(
    HttpRouter.post(
      '/api/counter-sale',
      requireOrganization(SELL_AT_CHANNEL)(organizationId =>
        withTenantDatabase(organizationId, counterSaleRoute(organizationId)),
      ),
    ),
  );
