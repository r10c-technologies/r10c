import { AmqpEventBusLayer, AmqpLayer } from '@r10c/entifix-ts-amqp-client';
import { ConfigurationRepositoryTag } from '@r10c/entifix-ts-business';
import { ConfigurationStoreInMemory } from '@r10c/entifix-ts-core';
import { MongoDatabaseLayer } from '@r10c/entifix-ts-mongo-client';
import {
  LoadedConfigurationTag,
  loadRemoteConfiguration,
} from '@r10c/shells-effect-service';
import { Effect, Layer } from 'effect';

import { MongoTransactionStoreLayer } from './store';
import { startTracking } from './tracking';

const SERVICE_NAME = 'transaction-manager';
const CONFIG_API_URL = process.env.CONFIG_API_URL ?? 'http://localhost:3190';

/**
 * The transaction-manager composition root. Resolves its Mongo + RabbitMQ
 * settings from config-service at boot, then layers: infra (Mongo + AMQP
 * connections) → services (transaction store + event bus) → tracking (the bus
 * subscription + recovery sweep). Any boot failure crashes the service (`orDie`).
 */
export const AppLayer = Layer.unwrapEffect(
  Effect.gen(function* () {
    const plain = yield* loadRemoteConfiguration(CONFIG_API_URL, SERVICE_NAME);
    const store = new ConfigurationStoreInMemory(plain);

    const uri = yield* store.in('mongo').getString('uri');
    const dbName = yield* store.in('mongo').getString('db');
    const amqpUri = yield* store.in('rabbitmq').getString('uri');

    const infra = Layer.mergeAll(
      MongoDatabaseLayer({ uri, dbName }),
      AmqpLayer({ uri: amqpUri }),
      Layer.succeed(ConfigurationRepositoryTag, store),
      Layer.succeed(LoadedConfigurationTag, plain),
    );

    // The store + bus are built from the infra connections.
    const services = Layer.provideMerge(
      Layer.mergeAll(MongoTransactionStoreLayer, AmqpEventBusLayer),
      infra,
    );

    // Tracking consumes the store + bus and starts at boot.
    return Layer.provideMerge(Layer.effectDiscard(startTracking), services);
  }).pipe(Effect.orDie),
).pipe(Layer.orDie);
