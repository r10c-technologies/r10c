import { NotFound } from '@entifix/core';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { InvalidFiscalIdentity } from '../../failures/organization-failures.js';
import { OrganizationFiscalIdentityTag } from '../../ports/organization-fiscal-identity.js';
import type { FiscalIdentity } from '../../values/fiscal-identity.js';
import {
  SET_FISCAL_IDENTITY,
  SetFiscalIdentityUC,
} from './set-fiscal-identity.uc.js';

const PAYLOAD = {
  taxId: '1234567-9',
  legalName: 'Demo, S.A.',
  taxRegime: 'small-taxpayer',
  establishmentCode: '2',
};

const run = (activeOrganizationId: string | undefined, payload = PAYLOAD) => {
  const written: Array<[string, FiscalIdentity]> = [];
  const exit = Effect.runSyncExit(
    SetFiscalIdentityUC.run({
      activeOrganizationId,
      organizationId: 'org-1',
      payload,
    }).pipe(
      Effect.provideService(OrganizationFiscalIdentityTag, {
        get: () => Effect.succeed(undefined),
        set: (id, identity) =>
          Effect.sync(() => {
            written.push([id, identity]);
          }),
      }),
    ),
  );
  return { exit, written };
};

describe('SetFiscalIdentityUC', () => {
  it('derives its permission from the verb', () => {
    expect(SET_FISCAL_IDENTITY).toBe(
      'party-management:organization:set-fiscal-identity',
    );
  });

  it('writes the normalized identity of the active organization', () => {
    const { exit, written } = run('org-1');
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(written).toEqual([
      [
        'org-1',
        {
          taxId: '12345679',
          legalName: 'Demo, S.A.',
          taxRegime: 'small-taxpayer',
          establishmentCode: '2',
        },
      ],
    ]);
  });

  it.each([undefined, 'org-2'])(
    'answers NotFound for an organization the session is not in (%s)',
    active => {
      const { exit, written } = run(active);
      expect(exit).toEqual(Exit.fail(new NotFound({ entity: 'organization' })));
      expect(written).toEqual([]);
    },
  );

  it('refuses an invalid identity and writes nothing', () => {
    const { exit, written } = run('org-1', { ...PAYLOAD, taxId: '1' });
    expect(exit).toEqual(
      Exit.fail(new InvalidFiscalIdentity({ field: 'taxId' })),
    );
    expect(written).toEqual([]);
  });
});

describe('InvalidFiscalIdentity', () => {
  it('names the member, under its permanent code', () => {
    const failure = new InvalidFiscalIdentity({ field: 'legalName' });
    expect(failure.code).toBe('invalidFiscalIdentity');
    expect(failure.message).toContain('legalName');
  });
});
