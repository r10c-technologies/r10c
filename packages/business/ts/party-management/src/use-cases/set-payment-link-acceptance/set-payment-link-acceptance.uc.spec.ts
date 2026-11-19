import { NotFound } from '@entifix/core';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { OrganizationPaymentLinkAcceptanceTag } from '../../ports/organization-payment-link-acceptance.js';
import {
  SET_PAYMENT_LINK_ACCEPTANCE,
  SetPaymentLinkAcceptanceUC,
} from './set-payment-link-acceptance.uc.js';

const run = (activeOrganizationId: string | undefined, accepts: boolean) => {
  const written: Array<[string, boolean]> = [];
  const exit = Effect.runSyncExit(
    SetPaymentLinkAcceptanceUC.run({
      activeOrganizationId,
      organizationId: 'org-1',
      payload: { accepts },
    }).pipe(
      Effect.provideService(OrganizationPaymentLinkAcceptanceTag, {
        get: () => Effect.succeed(false),
        set: (id, value) =>
          Effect.sync(() => {
            written.push([id, value]);
          }),
      }),
    ),
  );
  return { exit, written };
};

describe('SetPaymentLinkAcceptanceUC', () => {
  it('derives its permission from the verb', () => {
    expect(SET_PAYMENT_LINK_ACCEPTANCE).toBe(
      'party-management:organization:set-payment-link-acceptance',
    );
  });

  it.each([true, false])(
    'writes the active organization’s choice (%s)',
    accepts => {
      const { exit, written } = run('org-1', accepts);
      expect(exit).toEqual(Exit.succeed({ accepts }));
      expect(written).toEqual([['org-1', accepts]]);
    },
  );

  it.each([undefined, 'org-2'])(
    'answers NotFound for an organization the session is not in (%s)',
    active => {
      const { exit, written } = run(active, true);
      expect(exit).toEqual(Exit.fail(new NotFound({ entity: 'organization' })));
      expect(written).toEqual([]);
    },
  );
});
