import { Context } from 'effect';

/**
 * The name of the slice publishing an event — `marketplace-admin`, `order`.
 *
 * A **slice**, deliberately, and not one of the two nearer alternatives. Not the
 * deployment: co-deploying two slices into one process is reversible, and a
 * `source` that changed when a process moved would rewrite history for a fact
 * that did not change. Not the domain either: a slice may hold several, so the
 * domain does not identify the publisher. The slice is ADR 0020's ownership
 * noun and is already executable in `tools/slices/`, which is what lets the
 * register be checked against what the bus actually carries.
 *
 * Provided at each composition root beside the other environment facts
 * (`TenantDatabasePrefix`, `SagaDatabaseName`) rather than read from an
 * environment variable, so a service that forgets it fails to build its layer
 * instead of publishing events signed by nobody.
 */
export class EventSourceTag extends Context.Tag('EventSourceTag')<
  EventSourceTag,
  string
>() {}
