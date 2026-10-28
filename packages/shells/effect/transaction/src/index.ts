/**
 * The `transaction` slice's shell, `shell:platform`: the slice declares no
 * domain. It holds the saga coordinator — the run and instance routes, the
 * HTTP dispatcher, the definitions it walks, the tracker and the resume and
 * recovery sweeps — because a shell may compose `@entifix/transactions/engine`
 * where a cell may not. transaction-service only mounts it (ADR 0064, which
 * ends ADR 0060's app exception).
 */
export { makeAppLayer, transactionComposition } from './app-layer.js';
export { router } from './router.js';
export {
  HttpSagaDispatcherLayer,
  ParticipantsTag,
} from './saga/http-dispatcher.js';
export { sagaStoresLayer } from './saga/stores.js';
export { cancellationSaga, checkoutSaga, SAGAS } from './sagas/index.js';
