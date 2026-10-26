import type { Role } from '@r10c/business-ts-authz-grants';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { IdentifierType } from '../entities/entity-identifier';
import { UserStatus } from '../entities/user-identity';
import { AuthnError } from '../errors';
import type { AccountRepository } from '../repository/account.repository';

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);

const ADMIN = 'admin' as Role;
const STAFF = 'staff' as Role;

const ada = {
  displayName: 'Ada',
  role: STAFF,
  identifiers: [{ type: IdentifierType.Email, value: 'ada@example.com' }],
};

/**
 * What every {@link AccountRepository} must guarantee, through the port alone:
 * - an account opens active, findable by id and by each identifier it was
 *   made with, and an identifier belongs to one account only;
 * - the aspects an administrator changes are the ones read back;
 * - an external subject is one per account, replaced rather than added;
 * - what the provider says about a user lands on the user's own records.
 *
 * `make` returns a fresh, empty repository.
 */
export const describeAccountRepositoryContract = (
  name: string,
  make: () => AccountRepository | Promise<AccountRepository>,
) => {
  describe(`${name} honours the AccountRepository contract`, () => {
    it('opens an account active, and finds it by id, by identifier and by contact address', async () => {
      const accounts = await make();

      const created = await run(accounts.createAccount(ada));

      expect(created).toMatchObject({
        displayName: 'Ada',
        role: STAFF,
        status: UserStatus.Active,
      });
      expect(await run(accounts.findById(created.id))).toMatchObject({
        id: created.id,
      });
      expect(
        await run(accounts.findByIdentifier('ada@example.com')),
      ).toMatchObject({ id: created.id });
      expect(await run(accounts.findContactAddress(created.id))).toBe(
        'ada@example.com',
      );
    });

    it('gives an identifier to one account only', async () => {
      const accounts = await make();
      await run(accounts.createAccount(ada));

      const refused = await run(
        Effect.flip(accounts.createAccount({ ...ada, displayName: 'Imposter' })),
      );

      expect(refused).toBeInstanceOf(AuthnError);
    });

    it('knows nobody it never made', async () => {
      const accounts = await make();

      expect(await run(accounts.findById('nobody'))).toBeNull();
      expect(await run(accounts.findByIdentifier('nobody@x'))).toBeNull();
      expect(await run(accounts.findContactAddress('nobody'))).toBeNull();
      // A projection for a user deleted under it lands nowhere, and fails no
      // sign-in.
      await run(
        accounts.projectIdentity('nobody', {
          displayName: 'Ghost',
          emailVerified: false,
        }),
      );
      expect(
        await run(
          Effect.flip(
            accounts.updateUserAspects('nobody', { role: ADMIN }),
          ),
        ),
      ).toBeInstanceOf(AuthnError);
    });

    it('reads back the aspects an administrator changed, and only those', async () => {
      const accounts = await make();
      const { id } = await run(accounts.createAccount(ada));

      const promoted = await run(
        accounts.updateUserAspects(id, { role: ADMIN }),
      );
      const suspended = await run(
        accounts.updateUserAspects(id, { status: UserStatus.Suspended }),
      );

      expect(promoted).toMatchObject({ role: ADMIN, status: 'active' });
      expect(suspended).toMatchObject({ role: ADMIN, status: 'suspended' });
    });

    it('keeps one external subject per account, replacing it', async () => {
      const accounts = await make();
      const { id } = await run(accounts.createAccount(ada));

      await run(accounts.linkExternalSubject(id, 'sub-1', 'zitadel'));
      await run(accounts.linkExternalSubject(id, 'sub-2', 'zitadel'));

      expect(await run(accounts.findByIdentifier('sub-2'))).toMatchObject({
        id,
      });
      expect(await run(accounts.findByIdentifier('sub-1'))).toBeNull();
    });

    it("lands what the provider says on the user's own records", async () => {
      const accounts = await make();
      const { id } = await run(
        accounts.createAccount({ role: STAFF, identifiers: [] }),
      );

      await run(
        accounts.projectIdentity(id, {
          displayName: 'Ada L.',
          email: 'ada@example.com',
          emailVerified: true,
        }),
      );
      await run(
        accounts.projectIdentity(id, {
          email: 'ada@lovelace.dev',
          emailVerified: true,
        }),
      );

      expect(await run(accounts.findById(id))).toMatchObject({
        displayName: 'Ada L.',
      });
      expect(await run(accounts.findContactAddress(id))).toBe(
        'ada@lovelace.dev',
      );
      expect(
        await run(accounts.findByIdentifier('ada@lovelace.dev')),
      ).toMatchObject({ id });
    });
  });
};
