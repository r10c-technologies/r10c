import { Failure, type Overloaded, UpstreamUnavailable } from '@entifix/core';
import { On, RetryBudgetTag } from '@entifix/transactions';
import { Context, Effect, Layer } from 'effect';

/**
 * What the coordinator verifies about each vendor a flow acts for: the
 * entitlements a vendor segment's steps are checked against
 * ([ADR 0066](../../../../../../docs/adr/0066-flows-run-on-a-durable-workflow-engine.md)).
 *
 * ⚠️ **Verified here, never taken from the caller.** A storefront buyer holds
 * no entitlement at all, and a start input naming its vendors' entitlements
 * would let any caller holding the inbound token promise a step whatever it
 * requires. The coordinator overwrites whatever the input said with what it
 * reads.
 */
export interface VendorFacts {
  /** Each vendor's entitlements; a vendor nothing is known about holds none. */
  readonly entitlementsOf: (
    vendorIds: readonly string[],
  ) => Effect.Effect<
    ReadonlyMap<string, readonly string[]>,
    UpstreamUnavailable | Overloaded
  >;
}

export class VendorFactsTag extends Context.Service<
  VendorFactsTag,
  VendorFacts
>()('VendorFactsTag') {}

const STOCK = 'stock-management';
const SHIPPING = 'shipping-order-management';

/** The entitlements a published seller's two commerce facts stand for. */
export const entitlementsOfSeller = (seller: Record<string, unknown>) => [
  ...(seller['holdsStock'] === true ? [STOCK] : []),
  ...(seller['acceptsCod'] === true ? [SHIPPING] : []),
];

/**
 * The {@link VendorFactsTag} over the published vendor projection's anonymous
 * read — the record auth-service announced off each organization's
 * entitlement, which marketplace-service projects and payment-service already
 * reads for cash on delivery. Anonymous because the projection is platform
 * plane, and this slice opens no store of another's.
 *
 * A projection that cannot be reached, or answers `5xx`, is
 * `UpstreamUnavailable` rather than "no entitlements": a checkout is not
 * refused because a read is down. That failure is retried here, under the
 * process's retry budget — the read is a `GET`, so asking twice does nothing
 * twice.
 */
export const httpVendorFactsLayer = (catalogUrl: string) =>
  Layer.effect(
    VendorFactsTag,
    Effect.gen(function* () {
      const budget = yield* RetryBudgetTag;
      const unavailable = new UpstreamUnavailable({
        upstream: 'marketplace-service',
      });
      return {
        entitlementsOf: vendorIds =>
          Effect.tryPromise({
            try: () =>
              fetch(
                `${catalogUrl}/published-vendor?rsql=${encodeURIComponent(
                  `vendorId=in=(${vendorIds.join(',')})`,
                )}&pageSize=${String(vendorIds.length)}`,
              ),
            catch: () => unavailable,
          }).pipe(
            Effect.flatMap(response =>
              response.ok
                ? Effect.tryPromise({
                    try: () =>
                      response.json() as Promise<{
                        data?: {
                          items?: ReadonlyArray<Record<string, unknown>>;
                        };
                      }>,
                    catch: () => unavailable,
                  })
                : Effect.fail(unavailable),
            ),
            Effect.map(
              payload =>
                new Map(
                  vendorIds.map(vendorId => {
                    const seller = payload.data?.items?.find(
                      item => item['vendorId'] === vendorId,
                    );
                    return [
                      vendorId,
                      seller === undefined ? [] : entitlementsOfSeller(seller),
                    ] as const;
                  }),
                ),
            ),
            On(Failure.isCategory('unavailable')).retry({
              key: { dependency: 'marketplace-service' },
              idempotent: true,
            }),
            Effect.provideService(RetryBudgetTag, budget),
          ),
      };
    }),
  );
