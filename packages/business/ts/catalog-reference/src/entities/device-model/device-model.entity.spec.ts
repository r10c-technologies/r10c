import { describeEntityColumns, serializeEntity } from '@entifix/core';
import { describe, expect, it } from 'vitest';

import { DeviceModel } from './device-model.entity.js';

describe('DeviceModel', () => {
  it('round-trips every accessor through its setter', () => {
    const model = new DeviceModel('Samsung Galaxy A15');
    model.id = 'dm-1';
    model.code = 'device-001';
    model.maker = 'Samsung';
    model.revision = 2;

    expect(serializeEntity(DeviceModel, model)).toEqual({
      id: 'dm-1',
      code: 'device-001',
      name: 'Samsung Galaxy A15',
      maker: 'Samsung',
      status: 'active',
      revision: 2,
    });
  });

  it('takes its name from the constructor and starts active', () => {
    const model = new DeviceModel();
    model.name = 'iPhone 15';
    model.status = 'retired';

    expect(serializeEntity(DeviceModel, model)).toEqual({
      name: 'iPhone 15',
      status: 'retired',
    });
  });

  it('describes its columns with declared types and labels', () => {
    expect(
      describeEntityColumns(DeviceModel).map(column => [
        column.name,
        column.type,
        column.label,
      ]),
    ).toEqual([
      ['id', 'id', 'ID'],
      ['code', 'string', 'Code'],
      ['name', 'string', 'Name'],
      ['maker', 'string', 'Maker'],
      ['status', 'enum', 'Status'],
      ['revision', 'revision', 'Revision'],
    ]);
  });

  // The flag is the server-side allowlist: the vendor's picker searches `name`,
  // a reference resolves by `id`, and the operator narrows by `status` and
  // `maker`. Losing any of them is a silent `400`.
  it.each(['id', 'name', 'maker', 'status'])('declares %s filterable', name => {
    expect(
      describeEntityColumns(DeviceModel).find(column => column.name === name)
        ?.filterable,
    ).toBe(true);
  });
});
