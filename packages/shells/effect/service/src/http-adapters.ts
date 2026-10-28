import { EntifixConnError, Failure, UpstreamUnavailable } from '@entifix/core';
import { On, RetryBudgetTag } from '@entifix/transactions';
import {
  publishedPriceOf,
  PublishedPriceReaderTag,
} from '@r10c/business-ts-catalog-contracts';
import {
  sagaOutcomeFor,
  SagaStarterTag,
} from '@r10c/business-ts-saga-contracts';
import { postSaga } from '@r10c/utils-ts-fleet';
import { Effect, Layer } from 'effect';

/**
 * The {@link SagaStarterTag} over the coordinator's HTTP route, presenting its
 * **inbound** crossing token — the secret that starts a flow, which is never
 * the one a participant accepts when the coordinator dispatches to it.
 */
export const httpSagaStarterLayer = (coordinator: {
  readonly url: string;
  readonly crossingToken: string;
}) =>
  Layer.succeed(SagaStarterTag, {
    start: (definition, inputs) =>
      Effect.tryPromise({
        try: () =>
          postSaga(
            coordinator.url,
            coordinator.crossingToken,
            definition,
            inputs,
          ),
        catch: error =>
          new EntifixConnError('Failed to reach the saga coordinator', error, {
            definition,
          }),
      }).pipe(
        Effect.map(({ status, payload }) => sagaOutcomeFor(status, payload)),
      ),
  });

/**
 * The {@link PublishedPriceReaderTag} over the published projection's
 * anonymous read route — the same records the storefront charges against.
 * Anonymous because the projection is: it is platform plane.
 *
 * A catalog that cannot be reached, or answers `5xx`, is `UpstreamUnavailable`
 * rather than "no price": the sale is not unpriced, the projection is down.
 * That failure is retried here, under the process's retry budget
 * ([ADR 0064](../../../../../docs/adr/0064-failures-reach-the-slice-shell.md),
 * entifix ADR 0014) — this is the layer directly above it, and the read is a
 * `GET`, so asking twice cannot do anything twice. The coordinator's `POST`
 * above is **not** retried: it carries no `Idempotency-Key` until #456.
 */
export const httpPublishedPriceReaderLayer = (catalogUrl: string) =>
  Layer.effect(
    PublishedPriceReaderTag,
    Effect.gen(function* () {
      const budget = yield* RetryBudgetTag;
      const unavailable = new UpstreamUnavailable({
        upstream: 'marketplace-service',
      });
      return {
        priceOf: offeringId =>
          Effect.tryPromise({
            try: () =>
              fetch(
                `${catalogUrl}/published-offering?rsql=${encodeURIComponent(
                  `offeringId==${offeringId}`,
                )}&pageSize=1`,
              ),
            catch: () => unavailable,
          }).pipe(
            Effect.flatMap(response =>
              response.status >= 500
                ? Effect.fail(unavailable)
                : !response.ok
                  ? Effect.succeed(undefined)
                  : Effect.promise(
                      () =>
                        response.json() as Promise<{
                          data?: {
                            items?: ReadonlyArray<Record<string, unknown>>;
                          };
                        }>,
                    ).pipe(
                      Effect.map(payload =>
                        publishedPriceOf(offeringId, payload.data?.items?.[0]),
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
