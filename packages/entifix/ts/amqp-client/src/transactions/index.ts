/**
 * The half of this package that needs `@entifix/transactions`: the `EventBus`
 * implementation and the metrics it records.
 *
 * Behind a subpath so the connection and its health probe — which are just
 * AMQP — can be taken without the event envelope and the subscription model.
 * What keeps it optional is the `peerDependenciesMeta.optional` entry in the
 * manifest.
 */
export * from '../adapters/amqp-event-bus';
export * from '../adapters/bus-metrics';
