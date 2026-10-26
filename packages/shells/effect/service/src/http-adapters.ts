import { EntifixConnError } from '@entifix/core';
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
 */
export const httpPublishedPriceReaderLayer = (catalogUrl: string) =>
  Layer.succeed(PublishedPriceReaderTag, {
    priceOf: offeringId =>
      Effect.tryPromise({
        try: async () => {
          const query = encodeURIComponent(`offeringId==${offeringId}`);
          const response = await fetch(
            `${catalogUrl}/published-offering?rsql=${query}&pageSize=1`,
          );
          if (!response.ok) return undefined;
          const payload = (await response.json()) as {
            data?: { items?: ReadonlyArray<Record<string, unknown>> };
          };
          return publishedPriceOf(offeringId, payload.data?.items?.[0]);
        },
        catch: error =>
          new EntifixConnError('Failed to read a published price', error, {
            offeringId,
          }),
      }),
  });
