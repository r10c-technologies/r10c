import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { CATALOG_DOMAIN } from '../values/role-permissions.js';
import {
  makeStaticPolicyDecision,
  PolicyDecisionTag,
} from './policy-decision.js';

describe('makeStaticPolicyDecision', () => {
  const policy = makeStaticPolicyDecision();

  it('allows an action the subject’s roles grant', () => {
    expect(
      policy.decide({
        subject: { roles: ['user'] },
        resource: `${CATALOG_DOMAIN}:product`,
        action: 'read',
      }),
    ).toBe(true);
  });

  it('denies an action no role grants', () => {
    expect(
      policy.decide({
        subject: { roles: ['user'] },
        resource: 'authn:user-identity',
        action: 'write',
      }),
    ).toBe(false);
  });

  it('ignores resource attributes and context in v1', () => {
    expect(
      policy.decide({
        subject: { roles: ['super-admin'], attributes: { tenant: 'acme' } },
        resource: 'authn:user-identity',
        action: 'delete',
        context: { hour: 3 },
      }),
    ).toBe(true);
  });
});

describe('PolicyDecisionTag', () => {
  it('is resolvable from an Effect context', () => {
    const program = Effect.gen(function* () {
      const policy = yield* PolicyDecisionTag;
      return policy.decide({
        subject: { roles: ['admin'] },
        resource: 'authn:user-identity',
        action: 'write',
      });
    });

    const allowed = Effect.runSync(
      program.pipe(
        Effect.provideService(PolicyDecisionTag, makeStaticPolicyDecision()),
      ),
    );
    expect(allowed).toBe(true);
  });
});
