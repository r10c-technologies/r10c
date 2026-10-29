import { entityApi, extendFailurePolicy } from '@entifix/service-shell';
import {
  paymentApi,
  refundApi,
} from '@r10c/implementation-payment-management-http';
import {
  fleetFailurePolicy,
  serviceBaseGroup,
} from '@r10c/shells-effect-service';

/**
 * The `payment` slice's endpoints, served as one `HttpApi` by `makeService`
 * ([ADR 0071](../../../../../docs/adr/0071-http-cells-hold-descriptors-and-the-slice-shell-builds-the-api.md)).
 *
 * Platform plane throughout: the `payment` store is single-partitioned and
 * named at boot, so nothing here resolves a tenant handle. The generic reads
 * for both records are behind a session and the read grant; the two pivots
 * are behind a crossing token and no session.
 */
export const endpoints = [
  serviceBaseGroup({ service: '@r10c/payment-service', store: 'mongo' }),
  entityApi(paymentApi),
  entityApi(refundApi),
] as const;

/**
 * The fleet's policy, with the one status this slice answers differently: a
 * provider's refusal of money is `402 Payment Required`, the status the
 * coordinator and a person both read as "the money did not move", rather than
 * the `422` every other declined request answers (ADR 0064).
 */
export const policy = extendFailurePolicy(fleetFailurePolicy, {
  tagStatus: { PaymentDeclined: 402, RefundDeclined: 402 },
});
