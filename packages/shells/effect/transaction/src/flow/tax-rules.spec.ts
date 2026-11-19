import { Effect, Exit, Layer } from 'effect';
import { describe, expect, it } from 'vitest';

import { TaxRulesTag } from './checkout-tax.js';
import { taxRulesLayer } from './tax-rules.js';

const ROWS: Record<string, string> = {
  'iva.general.rate': '1200',
  'iva.general.basis': 'inclusive',
  'iva.small-taxpayer.rate': '500',
  'iva.small-taxpayer.basis': 'gross',
  'iva.simplified.rate': '1200',
  'iva.simplified.basis': 'inclusive',
};

const configuration = (rows: Record<string, string>) =>
  ({
    store: {
      in: () => ({
        getString: (key: string) => Effect.succeed(rows[key] ?? ''),
      }),
    },
  }) as never;

const rulesOf = (rows: Record<string, string>) =>
  Effect.runSyncExit(
    Effect.flatMap(taxRulesLayer(configuration(rows)), layer =>
      Effect.provide(
        Effect.gen(function* () {
          return yield* TaxRulesTag;
        }),
        layer as Layer.Layer<TaxRulesTag>,
      ),
    ),
  );

describe('taxRulesLayer', () => {
  it('reads every regime from the tax group', () => {
    const read = rulesOf(ROWS);
    expect(Exit.isSuccess(read) ? read.value.general : undefined).toEqual({
      rateBasisPoints: 1200,
      basis: 'inclusive',
    });
  });

  it('fails the boot on a malformed row, rather than guessing a rate', () => {
    expect(Exit.isFailure(rulesOf({ ...ROWS, 'iva.general.rate': 'x' }))).toBe(
      true,
    );
  });
});
