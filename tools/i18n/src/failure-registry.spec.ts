import { Failure } from '@entifix/core';
import { R10C_RESOURCES as resources } from '@r10c/i18n-catalog';
import { describe, expect, it } from 'vitest';

import { emissions } from './error-codes.js';
import {
  orphanKeys,
  registeredCodes,
  SYNTHESIZED_CODES,
  uncatalogedCodes,
} from './failure-registry.js';

const catalogs = {
  en: resources.en.errors as Record<string, unknown>,
  es: resources.es.errors as Record<string, unknown>,
};

/**
 * Keys a route still answers with by hand, through a shape the source scan
 * does not read — a domain refusal class, a code chosen at runtime. Each
 * becomes a registered failure when its slice migrates (wave 3, ADR 0064), and
 * this list may only shrink: a key that appears here newly is a code with
 * nothing behind it.
 */
const LEGACY_UNSCANNED: ReadonlySet<string> = new Set([
  'noCapturedPayment',
  'multiVendorOrder',
  'orderNotCancellable',
  'categoryParentMissing',
  'categoryParentRetired',
  'categoryCycle',
  'categoryTooDeep',
  'categoryHasChildren',
  'categoryTreeUnreadable',
  'mediaNotHttps',
  'mediaAltMissing',
  'paymentPending',
  'invalidCommand',
  'alreadyRetired',
  'inconsistentMovement',
  'channelInactive',
  'notYours',
  'secretRequiresValue',
]);

describe('Every registered failure is cataloged', () => {
  it('reads the registry entifix and the fleet fill', () => {
    // Core's generic set, the token failures beside the port, and the
    // service shell's organization refusal — a floor, not a pin.
    expect(registeredCodes()).toEqual(
      expect.arrayContaining([
        'notFound',
        'invalidToken',
        'noActiveOrganization',
      ]),
    );
  });

  it.each(['en', 'es'] as const)(
    'has a sentence in %s for every registered code',
    locale => {
      expect(
        uncatalogedCodes(registeredCodes(), catalogs[locale]),
        `these failures reach the browser as their own code — add them to\npackages/business/ts/i18n/src/${locale}/errors.ts`,
      ).toEqual([]);
    },
  );

  it('catches a failure defined with no sentence (planted)', () => {
    class Uncataloged extends Failure.declined<Uncataloged>()(
      'Uncataloged',
      'specUncatalogedFailure',
    ) {}
    void Uncataloged;

    expect(uncatalogedCodes(registeredCodes(), catalogs.es)).toEqual([
      'specUncatalogedFailure',
    ]);
  });
});

describe('Every catalog key has something behind it', () => {
  const known = new Set([
    ...registeredCodes(),
    ...emissions().map(emission => emission.code),
    ...SYNTHESIZED_CODES,
    ...LEGACY_UNSCANNED,
  ]);

  it.each(['en', 'es'] as const)(
    'names in %s only codes something answers with',
    locale => {
      expect(
        orphanKeys(catalogs[locale], known),
        'these keys name nothing a service or the browser can produce',
      ).toEqual([]);
    },
  );

  it('catches a key nothing answers with (planted)', () => {
    expect(orphanKeys({ ...catalogs.es, notAFailure: 'x' }, known)).toEqual([
      'notAFailure',
    ]);
  });

  it('still needs every legacy key it excuses', () => {
    const stale = [...LEGACY_UNSCANNED].filter(
      key => registeredCodes().includes(key) || !(key in catalogs.es),
    );

    expect(
      stale,
      'a migrated or deleted code: drop it from LEGACY_UNSCANNED',
    ).toEqual([]);
  });
});
