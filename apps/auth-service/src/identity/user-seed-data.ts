import { IdentifierType } from '@r10c/business-ts-authn';

/**
 * Seed users + identifiers for local development, in the entity wire shape.
 * `user-identity.identifiers` is a foreign-key collection (identifier ids);
 * each `entity-identifier.userId` points back to its canonical user. Mirrors the
 * "one user, many identifiers" model and the Ada Lovelace showcase.
 *
 * One seed user per role, which is also how the **first super-admin exists**:
 * the escalation rule means nobody can create a tier above their own, so the
 * top of the ladder has to be seeded rather than registered.
 */
export const userIdentitySeedData: ReadonlyArray<Record<string, unknown>> = [
  {
    id: 'user-1',
    displayName: 'Ada Lovelace',
    status: 'active',
    role: 'super-admin',
    identifiers: ['identifier-1', 'identifier-2'],
  },
  {
    id: 'user-2',
    displayName: 'Alan Turing',
    status: 'active',
    role: 'admin',
    identifiers: ['identifier-3'],
  },
  {
    id: 'user-3',
    displayName: 'Grace Hopper',
    status: 'active',
    role: 'user',
    identifiers: ['identifier-4'],
  },
];

export const entityIdentifierSeedData: ReadonlyArray<Record<string, unknown>> = [
  {
    id: 'identifier-1',
    userId: 'user-1',
    type: IdentifierType.Email,
    value: 'ada@example.com',
    verified: true,
  },
  {
    id: 'identifier-2',
    userId: 'user-1',
    type: IdentifierType.Username,
    value: 'ada',
    verified: true,
  },
  {
    id: 'identifier-3',
    userId: 'user-2',
    type: IdentifierType.Email,
    value: 'alan@example.com',
    verified: true,
  },
  {
    id: 'identifier-4',
    userId: 'user-3',
    type: IdentifierType.Email,
    value: 'grace@example.com',
    verified: true,
  },
];
