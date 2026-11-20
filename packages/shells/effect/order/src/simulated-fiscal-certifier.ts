import { Unavailable } from '@entifix/core';
import {
  type FiscalCertifier,
  FiscalCertifierTag,
  fiscalDocumentTypeFor,
} from '@r10c/business-ts-order-management';
import { Effect, Layer } from 'effect';

/**
 * How the simulated certifier answers. From config-service, group `fiscal`,
 * so a live pass can make it refuse or go silent without editing code.
 */
export type SimulatedCertifierOutcome = 'certify' | 'reject' | 'unavailable';

/** Narrow a configured string to an outcome, defaulting to `certify`. */
export const readCertifierOutcome = (
  value: string,
): SimulatedCertifierOutcome =>
  value === 'reject' || value === 'unavailable' ? value : 'certify';

/** The reason a simulated refusal carries. */
export const SIMULATED_REJECTION = 'rechazo simulado del certificador';

/**
 * A digest of the order id, in the shape a certifier's authorization takes:
 * eight, four, four, four and twelve upper-case hex digits. Derived rather
 * than random **on purpose**: the order id is the idempotency key, so the
 * same order asked about twice gets the same document, which is the property
 * a real certifier's internal identifier gives (#668).
 */
const hexOf = async (text: string) => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, '0'),
  )
    .join('')
    .toUpperCase();
};

const authorizationOf = (hex: string) =>
  [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');

/**
 * The v1 certifier: deterministic and offline. It picks the document type by
 * the seller's regime, derives the series from the first eight digits of the
 * authorization and the number from the next eight, as a FEL certifier does,
 * and never throws — so the failure branches the sweep depends on run real
 * code. What it does not do is sign anything with SAT.
 */
export const makeSimulatedFiscalCertifier = (
  outcome: SimulatedCertifierOutcome,
): FiscalCertifier => {
  const answer = <A>(make: (hex: string) => A, key: string) =>
    outcome === 'unavailable'
      ? Effect.fail(new Unavailable({ dependency: 'fiscal-certifier' }))
      : outcome === 'reject'
        ? Effect.succeed({
            _tag: 'rejected' as const,
            reason: SIMULATED_REJECTION,
          })
        : Effect.promise(() => hexOf(key)).pipe(
            Effect.map(hex => ({ _tag: 'done' as const, value: make(hex) })),
          );

  return {
    certify: (order, issuedAt) =>
      answer(
        hex => ({
          type: fiscalDocumentTypeFor(order.sellerTaxRegime),
          authorization: authorizationOf(hex),
          series: hex.slice(0, 8),
          number: String(Number.parseInt(hex.slice(8, 16), 16)),
          certifiedAt: issuedAt,
        }),
        String(order.id),
      ),
    void: (order, _reason, voidedAt) =>
      answer(
        hex => ({ authorization: authorizationOf(hex), voidedAt }),
        `void:${String(order.id)}`,
      ),
  };
};

export const SimulatedFiscalCertifierLayer = (
  outcome: SimulatedCertifierOutcome,
): Layer.Layer<FiscalCertifierTag> =>
  Layer.succeed(FiscalCertifierTag, makeSimulatedFiscalCertifier(outcome));
