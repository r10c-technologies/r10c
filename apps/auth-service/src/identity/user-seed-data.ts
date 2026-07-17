import { IdentifierType } from '@r10c/business-ts-authn';

/**
 * Seed users + identifiers for local development, in the entity wire shape.
 * `user-identity.identifiers` is a foreign-key collection (identifier ids);
 * each `entity-identifier.userId` points back to its canonical user. Mirrors the
 * "one user, many identifiers" model and the Ada Lovelace showcase.
 */
export const userIdentitySeedData: ReadonlyArray<Record<string, unknown>> = [
  {
    id: 'user-1',
    displayName: 'Ada Lovelace',
    status: 'active',
    identifiers: ['identifier-1', 'identifier-2'],
  },
  {
    id: 'user-2',
    displayName: 'Alan Turing',
    status: 'active',
    identifiers: ['identifier-3'],
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
];
