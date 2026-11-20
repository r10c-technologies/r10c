import { Context } from 'effect';

import type { Courier } from '../values/courier';

/**
 * The couriers a seller may name, from config-service's
 * `fulfilment-service / courier / <key>` rows — an open dictionary of public
 * facts, seeded with `other` alone (ADR 0081 §10).
 */
export class CouriersTag extends Context.Service<
  CouriersTag,
  readonly Courier[]
>()('CouriersTag') {}
