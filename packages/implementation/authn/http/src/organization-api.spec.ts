import { type EntityApiContext, RequestPrincipalTag } from '@entifix/business';
import { NotFound } from '@entifix/core';
import {
  type FiscalIdentity,
  InvalidFiscalIdentity,
  OrganizationFiscalIdentityTag,
} from '@r10c/business-ts-party-management';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { organizationApi, organizationEndpoints } from './organization-api.js';

const [setFiscalIdentity] = organizationApi.options.useCases;
const [readFiscalIdentity] = organizationEndpoints;

const FISCAL: FiscalIdentity = {
  taxId: '10000003',
  legalName: 'Demo Vendor, S.A.',
  taxRegime: 'general',
  establishmentCode: '1',
};

const store = () => {
  const rows = new Map<string, FiscalIdentity | undefined>([
    ['org-1', FISCAL],
    ['org-2', undefined],
  ]);
  return {
    rows,
    port: {
      get: (id: string) =>
        rows.has(id)
          ? Effect.succeed(rows.get(id))
          : Effect.fail(new NotFound({ entity: 'organization' })),
      set: (id: string, identity: FiscalIdentity) =>
        Effect.sync(() => {
          rows.set(id, identity);
        }),
    },
  };
};

const context = (organizationId: string | undefined) =>
  ({ principal: { organizationId } }) as unknown as EntityApiContext;

describe('set-fiscal-identity', () => {
  it('writes the active organization its own identity', async () => {
    const { rows, port } = store();
    const exit = await Effect.runPromiseExit(
      setFiscalIdentity
        .handler(
          {
            params: { id: 'org-1' },
            payload: { ...FISCAL, taxRegime: 'simplified' },
          },
          context('org-1'),
        )
        .pipe(Effect.provideService(OrganizationFiscalIdentityTag, port)),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(rows.get('org-1')?.taxRegime).toBe('simplified');
  });

  it('refuses another organization, and an invalid identity', async () => {
    const { port } = store();
    const run = (id: string, payload: unknown, active?: string) =>
      Effect.runPromiseExit(
        setFiscalIdentity
          .handler({ params: { id }, payload }, context(active))
          .pipe(Effect.provideService(OrganizationFiscalIdentityTag, port)),
      );
    expect(await run('org-2', FISCAL, 'org-1')).toEqual(
      Exit.fail(new NotFound({ entity: 'organization' })),
    );
    expect(await run('org-1', { ...FISCAL, taxId: '1' }, 'org-1')).toEqual(
      Exit.fail(new InvalidFiscalIdentity({ field: 'taxId' })),
    );
  });
});

describe('GET fiscal-identity', () => {
  const read = (id: string, organizationId: string) =>
    Effect.runPromiseExit(
      readFiscalIdentity.handler({ params: { id } } as never).pipe(
        Effect.provideService(OrganizationFiscalIdentityTag, store().port),
        Effect.provideService(RequestPrincipalTag, {
          organizationId,
        } as never),
      ) as Effect.Effect<unknown, unknown>,
    );

  it('answers the caller its own organization, null while it has none', async () => {
    expect(await read('org-1', 'org-1')).toEqual(
      Exit.succeed({ id: 'org-1', fiscal: FISCAL }),
    );
    expect(await read('org-2', 'org-2')).toEqual(
      Exit.succeed({ id: 'org-2', fiscal: null }),
    );
  });

  it('answers NotFound for any organization but the active one', async () => {
    expect(await read('org-1', 'org-2')).toEqual(
      Exit.fail(new NotFound({ entity: 'organization' })),
    );
  });
});
