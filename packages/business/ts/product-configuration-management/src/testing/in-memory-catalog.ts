import { deserializeSingleEntity, EntifixBuildError } from '@entifix/core';
import { readCommandEnvelope } from '@entifix/transactions';
import { Effect } from 'effect';

import { ProductSpecification } from '../entities/product-specification';
import type {
  OfferingCatalog,
  SpecificationCommands,
} from '../ports/offering-catalog';
import { refuseSpecificationMedia } from '../values/specification-media';

/** An organization's offerings, by id, as the status each one stands at. */
export type OfferingSeed = Readonly<
  Record<string, ReadonlyArray<{ readonly id: string; readonly status: string }>>
>;

/**
 * An {@link OfferingCatalog} held in memory, for the specs of whatever
 * consumes the port. It runs `describeOfferingCatalogContract`, so a
 * transition commits only from the status it was decided against.
 */
export const makeInMemoryOfferingCatalog = (
  seed: OfferingSeed = {},
): OfferingCatalog => {
  const statuses = new Map<string, string>();
  for (const [organizationId, offerings] of Object.entries(seed)) {
    for (const { id, status } of offerings) {
      statuses.set(`${organizationId}/${id}`, status);
    }
  }
  const announced = new Set<string>();

  return {
    commitTransition: (organizationId, offering, from, event) =>
      Effect.sync(() => {
        const key = `${organizationId}/${String(offering.id)}`;
        if (statuses.get(key) !== from) return 'changed';
        statuses.set(key, offering.status);
        announced.add(`${organizationId}/${event.id}`);
        return 'committed';
      }),
    reannounce: (organizationId, event) =>
      Effect.sync(() => {
        const key = `${organizationId}/${event.id}`;
        if (announced.has(key)) return 'alreadyAnnounced';
        announced.add(key);
        return 'announced';
      }),
  };
};

/**
 * A {@link SpecificationCommands} that accepts what the real one accepts and
 * writes nothing, for the specs of whatever consumes the port. It runs
 * `describeSpecificationCommandsContract`.
 */
export const makeInMemorySpecificationCommands = (): SpecificationCommands => ({
  accept: (_organizationId, body) =>
    Effect.gen(function* () {
      const command = yield* readCommandEnvelope(body);
      if (command.entity !== 'product-specification') {
        return yield* Effect.fail(
          new EntifixBuildError(
            `command entity "${command.entity}" does not match "product-specification"`,
          ),
        );
      }
      const specification = (yield* deserializeSingleEntity(
        ProductSpecification,
        command.payload,
      )) as ProductSpecification | undefined;
      if (!specification?.name) {
        return yield* Effect.fail(
          new EntifixBuildError('entity "name" is required'),
        );
      }
      yield* refuseSpecificationMedia(specification);
      return { transactionId: command.transactionId };
    }),
});
