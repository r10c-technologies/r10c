/**
 * The storefront tells a buyer the card payment is simulated — no card is
 * asked for and nothing is charged (ADR 0076 §7). That sentence is true only
 * while payment-service composes the simulated provider, and the day a real
 * one is wired in it becomes a promise the system breaks.
 *
 * So the sentence and the composition are checked together: copy that says
 * "simulated" in either locale fails this spec unless the payment shell's
 * layer still composes `SimulatedPaymentProviderLayer`. Swapping the adapter
 * means rewriting the copy in the same change.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const read = (...path: string[]) =>
  readFileSync(join(REPO_ROOT, ...path), 'utf8');

/** The storefront catalogs, by locale, that state the payment is simulated. */
const CATALOGS = {
  es: read('packages/business/ts/i18n/src/es/r10c.ts'),
  en: read('packages/business/ts/i18n/src/en/r10c.ts'),
};

/** Where payment-service's provider is chosen. */
const PAYMENT_LAYER = read('packages/shells/effect/payment/src/app-layer.ts');

/** How each locale words the claim. */
const CLAIMS = { es: /Pago simulado/, en: /Simulated payment/ } as const;

/**
 * Why the copy and the composition disagree, or `undefined` when they agree:
 * the claim is made only while the simulated provider is what the layer
 * composes.
 */
const simulatedPaymentProblem = (
  catalogs: Readonly<Record<keyof typeof CLAIMS, string>>,
  paymentLayer: string,
): string | undefined => {
  const claiming = (Object.keys(CLAIMS) as (keyof typeof CLAIMS)[]).filter(
    locale => CLAIMS[locale].test(catalogs[locale]),
  );
  if (claiming.length === 0) return undefined;
  return /SimulatedPaymentProviderLayer\(/.test(paymentLayer)
    ? undefined
    : `the ${claiming.join(' and ')} storefront copy says the payment is simulated, but packages/shells/effect/payment/src/app-layer.ts no longer composes SimulatedPaymentProviderLayer — rewrite the copy in the same change`;
};

describe('the storefront says a card payment is simulated only while it is', () => {
  it('reads copy that makes the claim, in both locales', () => {
    expect(CLAIMS.es.test(CATALOGS.es)).toBe(true);
    expect(CLAIMS.en.test(CATALOGS.en)).toBe(true);
  });

  it('finds the simulated provider composed where the claim is made', () => {
    expect(simulatedPaymentProblem(CATALOGS, PAYMENT_LAYER)).toBeUndefined();
  });

  it('fails a planted layer that swapped the provider for a real one', () => {
    const planted = PAYMENT_LAYER.replaceAll(
      'SimulatedPaymentProviderLayer(',
      'RealPaymentProviderLayer(',
    );

    expect(simulatedPaymentProblem(CATALOGS, planted)).toMatch(
      /no longer composes SimulatedPaymentProviderLayer/,
    );
  });

  it('says nothing once the copy no longer makes the claim', () => {
    expect(
      simulatedPaymentProblem({ es: 'Tarjeta', en: 'Card' }, 'RealLayer()'),
    ).toBeUndefined();
  });
});
