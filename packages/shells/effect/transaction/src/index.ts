/**
 * The `transaction` slice's shell, `shell:platform`: the slice declares no
 * domain. It holds the saga coordinator — the run and instance routes, the
 * HTTP dispatcher, the definitions it walks and the resume sweep — and the
 * durable flow engine that replaces them (ADR 0066), because a shell may
 * compose `@entifix/transactions/engine` and `@entifix/workflow` where a cell
 * may not. transaction-service only mounts it (ADR 0064, which
 * ends ADR 0060's app exception).
 */
export {
  makeAppLayer,
  makeRunnerLayer,
  runnerComposition,
  transactionComposition,
} from './app-layer.js';
export { endpoints, policy } from './endpoints.js';
export {
  HttpSagaDispatcherLayer,
  ParticipantsTag,
} from './saga/http-dispatcher.js';
export { sagaStoresLayer } from './saga/stores.js';
export { cancellationSaga, checkoutSaga, SAGAS } from './sagas/index.js';
export {
  runnerPort,
  type RunnerReplica,
  WORKFLOW_STORE,
} from './workflow/workflow-layer.js';
