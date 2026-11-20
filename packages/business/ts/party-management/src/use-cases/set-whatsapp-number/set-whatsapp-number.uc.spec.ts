import { NotFound } from '@entifix/core';
import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { OrganizationWhatsappNumberTag } from '../../ports/organization-whatsapp-number.js';
import {
  SET_WHATSAPP_NUMBER,
  SetWhatsappNumberUC,
} from './set-whatsapp-number.uc.js';

const run = (activeOrganizationId: string | undefined, number: string) => {
  const written: Array<[string, string]> = [];
  const exit = Effect.runSyncExit(
    SetWhatsappNumberUC.run({
      activeOrganizationId,
      organizationId: 'org-1',
      payload: { number },
    }).pipe(
      Effect.provideService(OrganizationWhatsappNumberTag, {
        get: () => Effect.succeed(''),
        set: (id, value) =>
          Effect.sync(() => {
            written.push([id, value]);
          }),
      }),
    ),
  );
  return { exit, written };
};

describe('SetWhatsappNumberUC', () => {
  it('derives its permission from the verb', () => {
    expect(SET_WHATSAPP_NUMBER).toBe(
      'party-management:organization:set-whatsapp-number',
    );
  });

  it.each([
    ['5555-1234', '+50255551234'],
    [' +502 5555 1234 ', '+50255551234'],
    ['  ', ''],
  ])('writes %o as %o', (typed, stored) => {
    const { exit, written } = run('org-1', typed);
    expect(exit).toEqual(Exit.succeed({ number: stored }));
    expect(written).toEqual([['org-1', stored]]);
  });

  it('refuses a number that is not a Guatemalan one, writing nothing', () => {
    const { exit, written } = run('org-1', '123');
    expect(Exit.isFailure(exit)).toBe(true);
    expect(JSON.stringify(exit)).toContain('phoneNotGuatemalan');
    expect(written).toEqual([]);
  });

  it.each([undefined, 'org-2'])(
    'answers NotFound for an organization the session is not in (%s)',
    active => {
      const { exit, written } = run(active, '5555-1234');
      expect(exit).toEqual(Exit.fail(new NotFound({ entity: 'organization' })));
      expect(written).toEqual([]);
    },
  );
});
