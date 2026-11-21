import { describe, expect, it } from 'vitest';

import {
  declaredTypeOf,
  evidenceOutcomeOf,
  isEvidenceOutcome,
} from './evidence-outcome.js';

describe('a receipt upload’s outcome', () => {
  it('reads a 2xx as attached, and each refusal by its code', () => {
    expect(evidenceOutcomeOf(200, {})).toBe('attached');
    expect(evidenceOutcomeOf(400, { code: 'evidenceTypeRefused' })).toBe(
      'evidenceTypeRefused',
    );
    expect(evidenceOutcomeOf(422, { code: 'evidenceLimitReached' })).toBe(
      'evidenceLimitReached',
    );
    expect(evidenceOutcomeOf(409, { code: 'orderNotAwaitingPayment' })).toBe(
      'orderNotAwaitingPayment',
    );
  });

  it('reads the wire’s own refusals as the file’s, and anything else as failed', () => {
    expect(evidenceOutcomeOf(413, { code: 'payloadTooLarge' })).toBe(
      'evidenceTooLarge',
    );
    expect(evidenceOutcomeOf(415, { code: 'unsupportedMediaType' })).toBe(
      'evidenceTypeRefused',
    );
    expect(evidenceOutcomeOf(401, { code: 'cancelNotAuthorized' })).toBe(
      'failed',
    );
    expect(evidenceOutcomeOf(undefined, undefined)).toBe('failed');
    expect(evidenceOutcomeOf(500, { code: 'attached' })).toBe('failed');
  });

  it('narrows a query param to the closed set', () => {
    expect(isEvidenceOutcome('attached')).toBe(true);
    expect(isEvidenceOutcome('storefront.secret')).toBe(false);
  });

  it('declares a type the route takes, whatever the browser named', () => {
    expect(declaredTypeOf('image/png')).toBe('image/png');
    expect(declaredTypeOf('')).toBe('application/pdf');
    expect(declaredTypeOf('image/svg+xml')).toBe('application/pdf');
  });
});
