import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  challengeFor,
  CODE_CHALLENGE_METHOD,
  createOpaqueValue,
  createPkcePair,
} from './pkce.js';

describe('createPkcePair', () => {
  it('derives the challenge from the verifier it returns', () => {
    // The whole security property in one assertion: if these two ever stop
    // agreeing, every exchange fails with `invalid_grant` and the cause is
    // invisible from the outside.
    const { codeVerifier, codeChallenge } = createPkcePair();

    expect(codeChallenge).toBe(
      createHash('sha256').update(codeVerifier).digest('base64url'),
    );
  });

  it('never repeats a verifier', () => {
    const pairs = Array.from({ length: 32 }, () => createPkcePair());

    expect(new Set(pairs.map(pair => pair.codeVerifier)).size).toBe(32);
  });

  it('stays inside the length RFC 7636 allows', () => {
    const { codeVerifier } = createPkcePair();

    expect(codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(codeVerifier.length).toBeLessThanOrEqual(128);
  });

  it('produces URL-safe material', () => {
    // base64url rather than base64: `+`, `/` and `=` would each have to survive
    // a query-string round trip intact, and one of them eventually will not.
    const { codeVerifier, codeChallenge } = createPkcePair();

    expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('challengeFor', () => {
  it('is deterministic', () => {
    expect(challengeFor('verifier')).toBe(challengeFor('verifier'));
  });

  it('announces S256, never plain', () => {
    // `plain` sends the verifier itself to the authorization endpoint, which
    // defeats the point of PKCE for anything that can read the URL.
    expect(CODE_CHALLENGE_METHOD).toBe('S256');
  });
});

describe('createOpaqueValue', () => {
  it('is unguessable and unique', () => {
    const values = Array.from({ length: 32 }, () => createOpaqueValue());

    expect(new Set(values).size).toBe(32);
    expect(values[0]?.length).toBeGreaterThanOrEqual(32);
  });
});
