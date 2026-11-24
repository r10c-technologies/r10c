/**
 * Each service's OpenAPI document, built by `serviceOpenApi` — the assembly
 * `makeServerLayer` serves — so what the documentation site renders is exactly
 * what the service answers at `$openapi`, with no server and no network
 * (#654). The site may not import a shell, so `generate.ts` writes these to
 * `out/openapi/<deployment>.json`.
 *
 * One deployment per slice: the spec holds this table to the slice register,
 * so a slice promoted, renamed or co-deployed fails until it is written here.
 */
import { serviceOpenApi } from '@entifix/service-shell';
import * as auth from '@r10c/shells-effect-auth';
import * as config from '@r10c/shells-effect-config';
import * as fulfilment from '@r10c/shells-effect-fulfilment';
import * as marketplace from '@r10c/shells-effect-marketplace';
import * as marketplaceAdmin from '@r10c/shells-effect-marketplace-admin';
import * as order from '@r10c/shells-effect-order';
import * as payment from '@r10c/shells-effect-payment';
import * as realtime from '@r10c/shells-effect-realtime';
import * as sales from '@r10c/shells-effect-sales';
import * as settlement from '@r10c/shells-effect-settlement';
import * as stock from '@r10c/shells-effect-stock';
import * as transaction from '@r10c/shells-effect-transaction';

/** The slice each deployment hosts, and the shell its `main.ts` mounts. */
export const SERVICES = [
  { slice: 'auth', deployment: 'auth-service', shell: auth },
  { slice: 'config', deployment: 'config-service', shell: config },
  { slice: 'fulfilment', deployment: 'fulfilment-service', shell: fulfilment },
  {
    slice: 'marketplace',
    deployment: 'marketplace-service',
    shell: marketplace,
  },
  {
    slice: 'marketplace-admin',
    deployment: 'marketplace-admin-service',
    shell: marketplaceAdmin,
  },
  { slice: 'order', deployment: 'order-service', shell: order },
  { slice: 'payment', deployment: 'payment-service', shell: payment },
  { slice: 'realtime', deployment: 'realtime-service', shell: realtime },
  { slice: 'sales', deployment: 'sales-service', shell: sales },
  { slice: 'settlement', deployment: 'settlement-service', shell: settlement },
  { slice: 'stock', deployment: 'stock-service', shell: stock },
  {
    slice: 'transaction',
    deployment: 'transaction-service',
    shell: transaction,
  },
] as const;

/**
 * Every service's document. Each one is described — every `main.ts` names
 * the fleet token — so `$service` and `$openapi` are in every document, as
 * they are in every running service.
 */
export const serviceDocuments = () =>
  SERVICES.map(({ slice, deployment, shell }) => ({
    slice,
    deployment,
    document: serviceOpenApi({
      name: `@r10c/${deployment}`,
      slices: [slice],
      described: true,
      endpoints: shell.endpoints,
      policy: shell.policy,
    }),
  }));
