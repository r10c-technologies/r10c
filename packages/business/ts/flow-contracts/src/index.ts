/**
 * What flows speak across slices: how a host starts one and is told what to
 * follow, the refusal shape a fragment's participant answers, where a flow
 * stands, and the hint a browser receives for a record it may not read
 * ([ADR 0066](../../../../../docs/adr/0066-flows-run-on-a-durable-workflow-engine.md),
 * [ADR 0072](../../../../../docs/adr/0072-the-realtime-slice-flow-status-and-the-edge.md)).
 */
export * from './entity-hint.js';
export * from './flow-starter.js';
export * from './flow-status.js';
export * from './participant-refusal.js';
