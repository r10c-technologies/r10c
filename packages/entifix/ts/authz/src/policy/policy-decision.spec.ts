import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import type { Permission } from '../values/permission.js';
import type { GrantTable } from './can.js';
import {
  makeStaticPolicyDecision,
  PolicyDecisionTag,
} from './policy-decision.js';

const CATALOG_DOMAIN = 'catalog';

/**
 * The spec's own grant table. It used to be r10c's, which made the framework's
 * policy test assert one application's business rules.
 */
const GRANTS: GrantTable = {
  user: [`${CATALOG_DOMAIN}:product:read`] as readonly Permission[],
  admin: [
    `${CATALOG_DOMAIN}:product:read`,
    `${CATALOG_DOMAIN}:product:write`,
    'authn:user-identity:write',
  ],
  'super-admin': ['*:*:*'],
};

describe('makeStaticPolicyDecision', () => {
  const policy = makeStaticPolicyDecision(GRANTS);

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
        Effect.provideService(PolicyDecisionTag, makeStaticPolicyDecision(GRANTS)),
      ),
    );
    expect(allowed).toBe(true);
  });
});
