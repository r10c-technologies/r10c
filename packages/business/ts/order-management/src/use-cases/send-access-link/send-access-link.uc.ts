import { permissionForUseCase } from '@entifix/authz';
import { JsonBody, useCase } from '@entifix/core';
import { Schema } from 'effect';

import { CheckoutGroup } from '../../entities/checkout-group';

/**
 * "Find my order": mail a fresh one-time access link to the email a checkout
 * group holds, given its number and that email (ADR 0076 §6).
 *
 * A **collection** verb, because the caller does not know the group — a number
 * is never a credential (§5), and finding the group is the verb's own work. It
 * is a person's act reached only through the storefront, so it is served as a
 * crossing that only the storefront's own token opens, never a session and
 * never the coordinator's token; its derived permission is a line in
 * `SERVICE_CROSSING_PERMISSIONS`.
 *
 * It answers the same whatever matched, so it is not an oracle for which
 * numbers or emails exist, and it mails only the address on file.
 */
@useCase({
  entity: CheckoutGroup,
  key: 'send-access-link',
  binding: 'collection',
  placement: 'context-independent',
  labelKey: 'entity:checkout-group.useCases.sendAccessLink',
  // A number and an email, never a selection: the caller cannot name the
  // group. Any JSON is taken, so a malformed body answers like a miss.
  payload: JsonBody,
  success: Schema.Struct({ accepted: Schema.Literal(true) }),
})
export class SendAccessLinkUC {}

/**
 * The permission this use case derives. Import it; never retype the verb.
 */
export const SEND_ACCESS_LINK = permissionForUseCase(SendAccessLinkUC);
