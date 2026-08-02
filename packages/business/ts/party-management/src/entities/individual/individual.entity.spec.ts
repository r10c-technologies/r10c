import {
  describeEntityColumns,
  deserializeSingleEntity,
  serializeEntity,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { Individual } from './individual.entity.js';

describe('Individual', () => {
  it('serializes only what was set, so a party without an account stays partial', () => {
    // An individual can exist as a party — a contact, a payee — before or
    // without ever signing in. `userId` staying absent is that case.
    const individual = new Individual('Ada Lovelace');
    individual.id = 'ind-1';

    expect(serializeEntity(Individual, individual)).toEqual({
      id: 'ind-1',
      fullName: 'Ada Lovelace',
    });
  });

  it('carries the account link when there is one', async () => {
    const individual = await Effect.runPromise(
      deserializeSingleEntity(Individual, {
        id: 'ind-2',
        fullName: 'Grace Hopper',
        userId: 'user-9',
      }),
    );

    expect(individual?.userId).toBe('user-9');
  });

  it('describes its columns with declared types', () => {
    expect(
      describeEntityColumns(Individual).map(column => [
        column.name,
        column.type,
      ]),
    ).toEqual([
      ['id', 'id'],
      ['fullName', 'string'],
      ['userId', 'string'],
    ]);
  });

  it('allows looking a party up by its account id', () => {
    // How a sign-in gets from a `UserIdentity` to the party, and from there to
    // its memberships. Without `filterable` the service would answer 400.
    const userId = describeEntityColumns(Individual).find(
      column => column.name === 'userId',
    );

    expect(userId?.filterable).toBe(true);
  });
});
