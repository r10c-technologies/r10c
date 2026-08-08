import { createPrivateKey, createPublicKey } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  E2E_FOREIGN_PRIVATE_KEY_PEM,
  E2E_KEY_ID,
  E2E_PRIVATE_KEY_PEM,
  E2E_PUBLIC_KEY_PEM,
} from './signing-key.js';

/**
 * The public half a private PEM implies, in the same encoding as the fixture.
 *
 * Derived straight from the PEM rather than from a `KeyObject`: the workspace
 * resolves more than one copy of `@types/node`, so the `KeyObject` overload of
 * `createPublicKey` is typed against a different class than the one
 * `createPrivateKey` returns and the declaration pass rejects it.
 */
const publicHalfOf = (privateKeyPem: string): string =>
  createPublicKey(privateKeyPem)
    .export({ type: 'spki', format: 'pem' })
    .toString()
    .trim();

describe('the e2e signing key', () => {
  it('is a usable RSA pair', () => {
    expect(createPrivateKey(E2E_PRIVATE_KEY_PEM).asymmetricKeyType).toBe('rsa');
    expect(createPublicKey(E2E_PUBLIC_KEY_PEM).asymmetricKeyType).toBe('rsa');
    expect(E2E_KEY_ID).toBe('e2e-key');
  });

  it('pairs the published public half with the private one', () => {
    // The two halves are configured on opposite sides: the mock service layer
    // verifies with the public one, the spec helpers sign with the private one.
    // A mismatch would not fail loudly — it would make every suite reject every
    // token, which reads as a broken guard rather than a broken fixture.
    expect(publicHalfOf(E2E_PRIVATE_KEY_PEM)).toBe(E2E_PUBLIC_KEY_PEM.trim());
  });

  it('keeps the foreign key genuinely foreign', () => {
    // The forgery specs assert that a token signed with this key is refused.
    // Were it secretly the same key, those specs would pass while proving
    // nothing, so this is the check that keeps them honest.
    expect(E2E_FOREIGN_PRIVATE_KEY_PEM).not.toBe(E2E_PRIVATE_KEY_PEM);
    expect(publicHalfOf(E2E_FOREIGN_PRIVATE_KEY_PEM)).not.toBe(
      E2E_PUBLIC_KEY_PEM.trim(),
    );
  });
});
