/**
 * The failures the fleet can answer with, read from the registry entifix keeps
 * rather than scanned out of source
 * ([ADR 0064](../../../docs/adr/0064-failures-reach-the-slice-shell.md)).
 *
 * A failure registers its code the moment its class is defined, so importing
 * the packages that define failures is what fills the registry. Every package
 * that declares one belongs in the imports below — a business package's
 * refusals, a shell's — and a package left out is a code the gate cannot see.
 */
import '@entifix/business';
import '@entifix/service-shell';
import '@r10c/business-ts-authn';
import '@r10c/business-ts-catalog-contracts';
import '@r10c/business-ts-catalog-reference';
import '@r10c/business-ts-common';
import '@r10c/business-ts-configuration';
import '@r10c/business-ts-order-management';
import '@r10c/business-ts-payment-contracts';
import '@r10c/business-ts-payment-management';
import '@r10c/business-ts-product-configuration-management';
import '@r10c/business-ts-flow-contracts';
import '@r10c/business-ts-sales-management';
import '@r10c/business-ts-settlement-management';
import '@r10c/business-ts-shipping-order-management';
import '@r10c/business-ts-stock-management';

import { registeredFailures } from '@entifix/core';

/** Every registered code, ordered. */
export const registeredCodes = (): string[] =>
  registeredFailures().map(failure => failure.code);

/** Codes with no sentence in `catalog`. */
export const uncatalogedCodes = (
  codes: readonly string[],
  catalog: Readonly<Record<string, unknown>>,
): string[] => codes.filter(code => !(code in catalog));

/**
 * Catalog keys nothing can answer with: not a registered failure, not a code a
 * route still writes by hand, and not one the browser synthesizes itself.
 */
export const orphanKeys = (
  catalog: Readonly<Record<string, unknown>>,
  known: ReadonlySet<string>,
): string[] =>
  Object.keys(catalog).filter(key => !known.has(actionCode(key) ?? key));

/**
 * The code an `errors:<code>Action` key names the next step for, or
 * `undefined` for a key that is not one (entifix ADR 0028). An action key is
 * known exactly when its code is: a button labelled for a failure nothing
 * answers with is one nobody can reach, and a failure renamed without its
 * action key would leave the button behind.
 */
export const actionCode = (key: string): string | undefined =>
  key.endsWith('Action') && key.length > 'Action'.length
    ? key.slice(0, -'Action'.length)
    : undefined;

/**
 * Codes the browser composes on its own — no service answers with them, so no
 * scan and no registry can find them. Kept short: a key here is a key nothing
 * checks.
 */
export const SYNTHESIZED_CODES: ReadonlySet<string> = new Set([
  'network',
  'configUnavailable',
  'unexpected',
]);
