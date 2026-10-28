import { generateKeyPairSync } from 'node:crypto';

import { makeRecordingEventBus } from '@entifix/testing-unit';
import { EventBusTag } from '@entifix/transactions';
import { catalogPublishedEvent } from '@r10c/business-ts-catalog-contracts';
import {
  type PublishedCatalog,
  PublishedCatalogTag,
} from '@r10c/business-ts-marketplace-catalog';
import {
  type PublishedVendors,
  PublishedVendorsTag,
} from '@r10c/business-ts-marketplace-vendor';
import { organizationAnnouncedEvent } from '@r10c/business-ts-party-contracts';
import {
  configurationRows,
  fleetConfigurationOf,
} from '@r10c/shells-effect-service';
import { Effect, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  makeAppLayer,
  marketplaceComposition,
  router,
  startProjecting,
  startProjectingVendors,
} from './index.js';

const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

const CONFIGURATION = fleetConfigurationOf({
  jwt: configurationRows({
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    keyId: 'spec-key',
  }),
  mongo: configurationRows({
    uri: 'mongodb://127.0.0.1:1/?directConnection=true',
    db: 'marketplace',
  }),
  rabbitmq: configurationRows({ uri: 'amqp://127.0.0.1:1' }),
  amqp: configurationRows({ uri: 'amqp://127.0.0.1:1' }),
});

const seed = Effect.void;

describe('the marketplace shell', () => {
  it('composes from its configuration without dialling anything', async () => {
    const layer = await Effect.runPromise(
      marketplaceComposition({ seed })(CONFIGURATION),
    );

    expect(Layer.isLayer(layer)).toBe(true);
  });

  it('refuses a configuration with no store, at boot', async () => {
    const exit = await Effect.runPromiseExit(
      marketplaceComposition({ seed })(
        fleetConfigurationOf({ ...CONFIGURATION.plain, mongo: [] }),
      ),
    );

    expect(exit._tag).toBe('Failure');
  });

  it('offers the booted composition and the routes as layers', () => {
    expect(Layer.isLayer(makeAppLayer({ seed }))).toBe(true);
    expect(Layer.isLayer(router)).toBe(true);
  });
});

describe('the two projections', () => {
  it('applies a publication and an announcement off the bus', async () => {
    const bus = makeRecordingEventBus();
    const applied: unknown[] = [];
    const catalog = {
      apply: (name: string, publication: unknown) =>
        Effect.sync(() => {
          applied.push([name, publication]);
        }),
    } as unknown as PublishedCatalog;
    const vendors = {
      apply: (announcement: unknown) =>
        Effect.sync(() => {
          applied.push(announcement);
        }),
    } as unknown as PublishedVendors;
    const publication = {
      offeringId: 'offering-1',
      vendorId: 'org-1',
      name: 'A hand-thrown mug',
      amount: 24_900,
      currency: 'GTQ',
      availableHint: true,
      publishedAt: '2026-09-07T10:00:00.000Z',
    };
    const announcement = {
      organizationId: 'org-1',
      displayName: 'Demo Vendor',
      announcedAt: '2026-10-23T10:00:00.000Z',
    };

    await Effect.runPromise(
      Effect.gen(function* () {
        yield* startProjecting;
        yield* startProjectingVendors;
        // Lazily: the double picks its subscribers when `deliver` is called.
        yield* Effect.suspend(() =>
          bus.deliver(catalogPublishedEvent(publication, 'marketplace-admin')),
        );
        yield* Effect.suspend(() =>
          bus.deliver(organizationAnnouncedEvent(announcement, 'auth')),
        );
      }).pipe(
        Effect.provideService(EventBusTag, bus),
        Effect.provideService(PublishedCatalogTag, catalog),
        Effect.provideService(PublishedVendorsTag, vendors),
      ),
    );

    expect(applied).toEqual([
      [
        'catalog.published',
        expect.objectContaining({ offeringId: 'offering-1' }),
      ],
      expect.objectContaining({ organizationId: 'org-1' }),
    ]);
  });
});
