import {
  defaultFailurePolicy,
  extendFailurePolicy,
  type FailurePolicy,
} from '@entifix/service-shell';

/**
 * How every r10c service answers and logs a failure
 * ([ADR 0064](../../../../../docs/adr/0064-failures-reach-the-slice-shell.md)).
 *
 * The category table entifix ships, unchanged so far: a slice's shell extends
 * this with its own per-tag statuses and levels, and never starts from
 * entifix's default, so a fleet-wide change lands in one place.
 */
export const fleetFailurePolicy: FailurePolicy = extendFailurePolicy(
  defaultFailurePolicy,
  {},
);
