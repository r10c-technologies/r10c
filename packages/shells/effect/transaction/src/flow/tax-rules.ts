import { TaxRegimes, taxRulesFrom } from '@r10c/business-ts-tax-policy';
import type { FleetConfiguration } from '@r10c/shells-effect-service';
import { Effect, Layer } from 'effect';

import { TaxRulesTag } from './checkout-tax.js';

/** The configuration group the IVA rules are rows in. */
export const TAX_GROUP = 'tax';

/**
 * Every regime's rule, read at boot from the `tax` group's
 * `iva.<regime>.rate` and `iva.<regime>.basis` rows. A missing or malformed
 * row fails the boot: a coordinator that guessed a rate would document every
 * order it states wrongly (ADR 0078 §6).
 */
export const taxRulesLayer = ({ store }: FleetConfiguration) =>
  Effect.gen(function* () {
    const group = store.in(TAX_GROUP);
    const values = new Map<string, string>();
    for (const regime of TaxRegimes) {
      for (const member of ['rate', 'basis']) {
        const key = `iva.${regime}.${member}`;
        values.set(key, yield* group.getString(key));
      }
    }
    const read = taxRulesFrom(key => values.get(key));
    if (!read.ok) {
      return yield* Effect.die(
        new Error(
          `tax configuration is ${read.problem.kind}: ${read.problem.key}`,
        ),
      );
    }
    return Layer.succeed(TaxRulesTag, read.rules);
  });
