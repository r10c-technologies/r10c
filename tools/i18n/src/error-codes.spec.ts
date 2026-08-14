/**
 * The gate: every error code the fleet emits has a sentence in the catalog.
 *
 * `tools/check-i18n.mjs` compares `es` against `en` and nothing else, so it
 * cannot see this failure at all — a code missing from *both* locales is
 * perfectly symmetric. Types cannot see it either, because the render path casts
 * the augmentation away. This is the only thing that looks.
 *
 * The scan pins the number of emission sites it finds. A regex-driven check that
 * silently stops matching would otherwise report green while asserting nothing,
 * which is the failure mode `docs.spec.ts` and `slices.spec.ts` guard the same
 * way.
 */
import { resources } from '@r10c/entifix-ts-i18n';
import { describe, expect, it } from 'vitest';

import { emissions, emittedCodes } from './error-codes.js';

/** `es` is the reference locale; `en` is typed from it, so parity is a compile
 * error and this file only needs to look at one. */
const cataloged = new Set(Object.keys(resources.es.errors));

describe('The scanner', () => {
  it('reads a code out of a response body literal', () => {
    expect(
      emittedCodes(
        `{ error: 'no active organization', code: 'noActiveOrganization' }`,
      ),
    ).toEqual(['noActiveOrganization']);
  });

  it('reads one Prettier has broken across lines', () => {
    expect(
      emittedCodes(`HttpServerResponse.json(
        {
          error: 'clearing the secret flag requires a new value',
          code: 'secretRequiresValue',
        },
        { status: 400 },
      )`),
    ).toEqual(['secretRequiresValue']);
  });

  it('reads the default behind a nullish coalesce', () => {
    // `respondAuthError` supplies this when the error carried no code of its own.
    expect(
      emittedCodes(
        `{ error: 'invalid credentials', code: code ?? 'invalidCredentials' }`,
      ),
    ).toEqual(['invalidCredentials']);
  });

  it('reads the second argument of a CodedAuthnError subclass', () => {
    // These never appear as a `code:` property; `respondAuthError` lifts them
    // onto one on the way out, so a body-shape-only scan would miss them.
    expect(
      emittedCodes(`new UnauthenticatedError(
        'the authorization state is unknown or spent',
        'invalidState',
      )`),
    ).toEqual(['invalidState']);
    expect(
      emittedCodes(
        `new AuthnError(\`could not resolve: \${String(error)}\`, 'signInFailed')`,
      ),
    ).toEqual(['signInFailed']);
  });

  it('ignores a `code` member that is not part of an error body', () => {
    // The false-positive guard, and the reason the *pair* is matched rather than
    // a bare `code:`. ADR 0014's dictionary terms carry a `code`, as do several
    // entities; none of them belong in an error catalog.
    expect(
      emittedCodes(`const term = { code: 'colour', unit: 'none' };`),
    ).toEqual([]);
    expect(emittedCodes(`this.#code = code;`)).toEqual([]);
  });
});

describe('Every emitted error code is cataloged', () => {
  it('still finds the emission sites it is meant to check', () => {
    const found = emissions();

    // 48 sites across 12 files when this gate was written. Pinned as a floor:
    // the number climbs as the fleet grows, and a drop means a matcher stopped
    // matching rather than that the fleet stopped failing.
    expect(found.length).toBeGreaterThanOrEqual(48);
    expect(
      new Set(found.map(emission => emission.file)).size,
    ).toBeGreaterThanOrEqual(12);
  });

  it('has a sentence for every code a service answers with', () => {
    const uncataloged = emissions()
      .filter(emission => !cataloged.has(emission.code))
      .map(emission => `${emission.code} (${emission.file})`);

    expect(
      [...new Set(uncataloged)],
      `these codes reach the browser as their own literal text — add them to\npackages/entifix/ts/i18n/src/resources/es/errors.ts:\n  ${[...new Set(uncataloged)].join('\n  ')}`,
    ).toEqual([]);
  });
});
