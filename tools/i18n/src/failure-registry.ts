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
): string[] => Object.keys(catalog).filter(key => !known.has(key));

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
