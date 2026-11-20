import { type EntityApiContext, RequestPrincipalTag } from '@entifix/business';
import { NotFound } from '@entifix/core';
import {
  type FiscalIdentity,
  InvalidFiscalIdentity,
  OrganizationFiscalIdentityTag,
  OrganizationPaymentLinkAcceptanceTag,
  OrganizationWhatsappNumberTag,
} from '@r10c/business-ts-party-management';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { organizationApi, organizationEndpoints } from './organization-api.js';

const [setFiscalIdentity, setPaymentLinkAcceptance, setWhatsappNumber] =
  organizationApi.options.useCases;
const [readFiscalIdentity, readPaymentLinkAcceptance, readWhatsappNumber] =
  organizationEndpoints;

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

const acceptanceStore = () => {
  const rows = new Map<string, boolean>([['org-1', false]]);
  return {
    rows,
    port: {
      get: (id: string) =>
        rows.has(id)
          ? Effect.succeed(rows.get(id) === true)
          : Effect.fail(new NotFound({ entity: 'organization' })),
      set: (id: string, accepts: boolean) =>
        Effect.sync(() => {
          rows.set(id, accepts);
        }),
    },
  };
};

describe('set-payment-link-acceptance', () => {
  it('writes the active organization its own choice, and refuses another', async () => {
    const { rows, port } = acceptanceStore();
    const run = (id: string, active: string) =>
      Effect.runPromiseExit(
        setPaymentLinkAcceptance
          .handler(
            { params: { id }, payload: { accepts: true } },
            context(active),
          )
          .pipe(
            Effect.provideService(OrganizationPaymentLinkAcceptanceTag, port),
          ),
      );
    expect(await run('org-1', 'org-1')).toEqual(
      Exit.succeed({ accepts: true }),
    );
    expect(rows.get('org-1')).toBe(true);
    expect(await run('org-2', 'org-1')).toEqual(
      Exit.fail(new NotFound({ entity: 'organization' })),
    );
  });
});

describe('GET payment-link-acceptance', () => {
  const read = (id: string, organizationId: string) =>
    Effect.runPromiseExit(
      readPaymentLinkAcceptance.handler({ params: { id } } as never).pipe(
        Effect.provideService(
          OrganizationPaymentLinkAcceptanceTag,
          acceptanceStore().port,
        ),
        Effect.provideService(RequestPrincipalTag, {
          organizationId,
        } as never),
      ) as Effect.Effect<unknown, unknown>,
    );

  it('answers the caller its own organization’s choice', async () => {
    expect(await read('org-1', 'org-1')).toEqual(
      Exit.succeed({ id: 'org-1', accepts: false }),
    );
  });

  it('answers NotFound for any organization but the active one', async () => {
    expect(await read('org-1', 'org-2')).toEqual(
      Exit.fail(new NotFound({ entity: 'organization' })),
    );
  });
});

const numberStore = () => {
  const rows = new Map<string, string>([['org-1', '+50255550000']]);
  return {
    rows,
    port: {
      get: (id: string) => Effect.succeed(rows.get(id) ?? ''),
      set: (id: string, number: string) =>
        Effect.sync(() => {
          rows.set(id, number);
        }),
    },
  };
};

describe('set-whatsapp-number', () => {
  it('writes the active organization its own number, and refuses another', async () => {
    const { rows, port } = numberStore();
    const run = (id: string, active: string) =>
      Effect.runPromiseExit(
        setWhatsappNumber
          .handler(
            { params: { id }, payload: { number: '5555-1234' } },
            context(active),
          )
          .pipe(Effect.provideService(OrganizationWhatsappNumberTag, port)),
      );
    expect(await run('org-1', 'org-1')).toEqual(
      Exit.succeed({ number: '+50255551234' }),
    );
    expect(rows.get('org-1')).toBe('+50255551234');
    expect(await run('org-2', 'org-1')).toEqual(
      Exit.fail(new NotFound({ entity: 'organization' })),
    );
  });
});

describe('GET whatsapp-number', () => {
  const read = (id: string, organizationId: string) =>
    Effect.runPromiseExit(
      readWhatsappNumber.handler({ params: { id } } as never).pipe(
        Effect.provideService(
          OrganizationWhatsappNumberTag,
          numberStore().port,
        ),
        Effect.provideService(RequestPrincipalTag, {
          organizationId,
        } as never),
      ) as Effect.Effect<unknown, unknown>,
    );

  it('answers the caller its own organization’s number', async () => {
    expect(await read('org-1', 'org-1')).toEqual(
      Exit.succeed({ id: 'org-1', number: '+50255550000' }),
    );
  });

  it('answers NotFound for any organization but the active one', async () => {
    expect(await read('org-1', 'org-2')).toEqual(
      Exit.fail(new NotFound({ entity: 'organization' })),
    );
  });
});
