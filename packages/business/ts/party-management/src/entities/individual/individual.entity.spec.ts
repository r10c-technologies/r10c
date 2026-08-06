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
      // Unlike `userId`, this one always serializes: a party the platform knows
      // nothing else about is still someone who shops here, and leaving the
      // plane selector absent would make "unknown" indistinguishable from
      // "not yet written".
      partyRole: 'customer',
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

  it('reads a stored party role back', async () => {
    // The value a sign-in resolves the session's plane from, so it has to
    // survive the round trip through storage rather than being recomputed.
    const individual = await Effect.runPromise(
      deserializeSingleEntity(Individual, {
        id: 'ind-3',
        fullName: 'Alan Turing',
        partyRole: 'vendor',
      }),
    );

    expect(individual?.partyRole).toBe('vendor');
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
      ['partyRole', 'enum'],
    ]);
  });

  it('offers the party role as a closed set, so it renders and filters', () => {
    // Declared `enum` rather than `string`: the raw `vendor` token would
    // otherwise reach the user untranslated, and the filter would offer
    // substring matching on a value set of three.
    const partyRole = describeEntityColumns(Individual).find(
      column => column.name === 'partyRole',
    );

    expect(partyRole?.enumValues).toEqual(['customer', 'vendor', 'operator']);
    expect(partyRole?.filterable).toBe(true);
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
