import { describeEntityColumns, serializeEntity } from '@r10c/entifix-ts-core';
import { describe, expect, it } from 'vitest';

import { SalesChannel } from './sales-channel.entity.js';

describe('SalesChannel', () => {
  it('round-trips every accessor through its setter', () => {
    const channel = new SalesChannel('Tienda Centro', 'counter');
    channel.id = 'sc-1';
    channel.name = 'Tienda Centro 2';
    channel.type = 'phone';
    channel.status = 'inactive';

    expect(serializeEntity(SalesChannel, channel)).toEqual({
      id: 'sc-1',
      name: 'Tienda Centro 2',
      type: 'phone',
      status: 'inactive',
    });
  });

  it('defaults to an active counter, the case the back office exists to serve', () => {
    expect(serializeEntity(SalesChannel, new SalesChannel())).toEqual({
      name: '',
      type: 'counter',
      status: 'active',
    });
  });

  it('describes its columns with declared types', () => {
    expect(
      describeEntityColumns(SalesChannel).map(column => [
        column.name,
        column.type,
      ]),
    ).toEqual([
      ['id', 'id'],
      ['name', 'string'],
      ['type', 'enum'],
      ['status', 'enum'],
    ]);
  });

  it('declares `name` filterable, because that is what the selling screen\n    searches and the flag is also the server-side RSQL allowlist', () => {
    // Losing it is silent at both ends: the service answers `400` and the picker
    // renders that as an empty suggestion list reading as "there are no
    // channels". `useEntityLinkSource` asserts the flag rather than trusting it.
    const name = describeEntityColumns(SalesChannel).find(
      column => column.name === 'name',
    );

    expect(name?.filterable).toBe(true);
  });

  it('declares `type` filterable, because settlement folds a payout by selecting\n    the lines that came through each channel type', () => {
    const type = describeEntityColumns(SalesChannel).find(
      column => column.name === 'type',
    );

    expect(type?.filterable).toBe(true);
  });

  it('points both enums at a label key, so the value is never rendered raw', () => {
    const columns = describeEntityColumns(SalesChannel);

    expect(
      columns
        .filter(column => column.type === 'enum')
        .map(column => [column.name, column.enumLabelKey]),
    ).toEqual([
      ['type', 'entity:sales-channel.values.type'],
      ['status', 'entity:sales-channel.values.status'],
    ]);
  });
});
