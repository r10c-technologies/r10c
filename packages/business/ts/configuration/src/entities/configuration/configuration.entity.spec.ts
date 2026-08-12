import { permissionForEntity } from '@r10c/business-ts-authz';
import {
  describeEntityColumns,
  deserializeSingleEntity,
  serializeEntity,
} from '@r10c/entifix-ts-core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { Configuration } from './configuration.entity.js';

const aRow = () => {
  const row = new Configuration();
  row.id = 'c-1';
  row.service = 'auth-service';
  row.groupName = 'mongo';
  row.key = 'uri';
  row.value = 'mongodb://localhost';
  row.isSecret = true;
  row.updatedAt = new Date('2026-07-30T00:00:00.000Z');
  row.updatedBy = 'ops@r10c.test';
  return row;
};

describe('Configuration', () => {
  it('serializes to its Postgres columns, not its member names', () => {
    // This is the whole column mapping: `alias` on the entity, nothing in the
    // adapter. If a member's alias drifts, the row stops matching the table.
    expect(serializeEntity(Configuration, aRow())).toEqual({
      id: 'c-1',
      service: 'auth-service',
      group_name: 'mongo',
      key: 'uri',
      value: 'mongodb://localhost',
      is_secret: true,
      updated_at: new Date('2026-07-30T00:00:00.000Z'),
      updated_by: 'ops@r10c.test',
    });
  });

  it('rebuilds itself from a row keyed by those same columns', async () => {
    const row = await Effect.runPromise(
      deserializeSingleEntity(Configuration, {
        id: 'c-2',
        service: 'marketplace-app',
        group_name: 'locale',
        key: 'default',
        value: 'es',
        is_secret: false,
      }),
    );

    expect(row?.groupName).toBe('locale');
    expect(row?.key).toBe('default');
    expect(row?.isSecret).toBe(false);
  });

  it('omits what was never set, so a partial write stays partial', () => {
    const row = new Configuration();
    row.service = 'auth-app';

    expect(serializeEntity(Configuration, row)).toEqual({
      service: 'auth-app',
    });
  });

  it('describes its columns with declared types and labels', () => {
    expect(
      describeEntityColumns(Configuration).map(column => [
        column.name,
        column.key,
        column.type,
      ]),
    ).toEqual([
      ['id', 'id', 'id'],
      ['service', 'service', 'string'],
      ['groupName', 'group_name', 'string'],
      ['key', 'key', 'string'],
      ['value', 'value', 'string'],
      ['isSecret', 'is_secret', 'boolean'],
      ['updatedAt', 'updated_at', 'date'],
      ['updatedBy', 'updated_by', 'string'],
    ]);
  });

  it('allows querying by the addressing members only', () => {
    const filterable = describeEntityColumns(Configuration)
      .filter(column => column.filterable)
      .map(column => column.name);

    // `value` is excluded on purpose: a filter is a read primitive, and this
    // column holds every credential in the fleet.
    expect(filterable).toEqual([
      'id',
      'service',
      'groupName',
      'key',
      'isSecret',
      'updatedAt',
      'updatedBy',
    ]);
    expect(filterable).not.toContain('value');
  });

  it('requires the addressing members', () => {
    const columns = describeEntityColumns(Configuration);
    const by = (name: string) => columns.find(column => column.name === name);

    expect(
      [by('service'), by('groupName'), by('key')].map(c => c?.required),
    ).toEqual([true, true, true]);
  });

  it('keeps the audit stamps on the wire in both directions', async () => {
    // They are server-owned, but `readonly` would drop them from serialization
    // *and* deserialization — so the route owns them instead, and they stay
    // visible. This asserts the read half; the route owns the write half.
    const row = await Effect.runPromise(
      deserializeSingleEntity(Configuration, {
        id: 'c-3',
        updated_by: 'ops@r10c.test',
      }),
    );

    expect(row?.updatedBy).toBe('ops@r10c.test');
  });

  it('derives its permissions from its own domain and key', () => {
    // No permission constant is declared anywhere; `super-admin`'s `*:*:*` is
    // what grants these.
    expect(permissionForEntity(Configuration, 'read')).toBe(
      'config:configuration:read',
    );
    expect(permissionForEntity(Configuration, 'write')).toBe(
      'config:configuration:write',
    );
    expect(permissionForEntity(Configuration, 'delete')).toBe(
      'config:configuration:delete',
    );
  });
});
