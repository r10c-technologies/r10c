import { Failure, UpstreamUnavailable } from '@entifix/core';
import { On, RetryBudgetTag } from '@entifix/transactions';
import { CodAcceptanceTag } from '@r10c/business-ts-payment-management';
import { Effect, Layer } from 'effect';

/**
 * The {@link CodAcceptanceTag} over the published vendor projection's
 * anonymous read route — the same record the storefront offers cash on
 * delivery from, as auth-service announced it off the seller's entitlement.
 * Anonymous because the projection is: it is platform plane, and this slice
 * opens no store but its own (ADR 0070).
 *
 * A seller the projection does not know does not ship cash on delivery. A
 * projection that cannot be reached, or answers `5xx`, is `UpstreamUnavailable`
 * rather than "no": the seller is not refused, the read is down. That failure
 * is retried here, under the process's retry budget — the read is a `GET`, so
 * asking twice cannot do anything twice.
 */
export const httpCodAcceptanceLayer = (catalogUrl: string) =>
  Layer.effect(
    CodAcceptanceTag,
    Effect.gen(function* () {
      const budget = yield* RetryBudgetTag;
      const unavailable = new UpstreamUnavailable({
        upstream: 'marketplace-service',
      });
      return {
        acceptsCod: vendorId =>
          Effect.tryPromise({
            try: () =>
              fetch(
                `${catalogUrl}/published-vendor?rsql=${encodeURIComponent(
                  `vendorId==${vendorId}`,
                )}&pageSize=1`,
              ),
            catch: () => unavailable,
          }).pipe(
            Effect.flatMap(response =>
              response.status >= 500
                ? Effect.fail(unavailable)
                : !response.ok
                  ? Effect.succeed(false)
                  : Effect.promise(
                      () =>
                        response.json() as Promise<{
                          data?: {
                            items?: ReadonlyArray<Record<string, unknown>>;
                          };
                        }>,
                    ).pipe(
                      Effect.map(
                        payload =>
                          payload.data?.items?.[0]?.['acceptsCod'] === true,
                      ),
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
