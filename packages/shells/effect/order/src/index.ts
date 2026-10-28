/**
 * The `order` slice's shell: its routes, and the composition that binds its
 * cells to the fleet — store, bus, relay and the payment-status projection.
 * order-service only mounts it (ADR 0064).
 */
export { makeAppLayer, ORDER_SLICE, orderComposition } from './app-layer.js';
export { capturedSubscription } from './payment-status.js';
export { router } from './router.js';
