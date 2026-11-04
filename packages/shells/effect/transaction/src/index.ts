/**
 * The `transaction` slice's shell, `shell:platform`: the slice declares no
 * domain. It holds the coordinator — the flow start routes and the durable
 * flow engine they hand slips to (ADR 0066) — because a shell may compose
 * `@entifix/transactions/engine` and `@entifix/workflow` where a cell may not.
 * transaction-service only mounts it (ADR 0064).
 */
export {
  makeAppLayer,
  makeRunnerLayer,
  runnerComposition,
  transactionComposition,
} from './app-layer.js';
export { endpoints, policy } from './endpoints.js';
export {
  httpVendorFactsLayer,
  type VendorFacts,
  VendorFactsTag,
} from './flow/vendor-facts.js';
export {
  type Participant,
  runnerPort,
  type RunnerReplica,
  WORKFLOW_STORE,
} from './workflow/workflow-layer.js';
