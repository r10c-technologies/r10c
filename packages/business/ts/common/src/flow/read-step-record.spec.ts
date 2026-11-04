import type { Entity, EntityId } from '@entifix/core';
import { accessor, entity } from '@entifix/core';
import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { readStepRecord } from './read-step-record.js';

@entity({ domain: 'spec', key: 'parcel' })
class Parcel implements Entity {
  #id?: EntityId;
  #weight = 0;

  @accessor({ labelKey: 'spec:parcel.id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor({ labelKey: 'spec:parcel.weight' })
  get weight(): number {
    return this.#weight;
  }
  set weight(value: number) {
    this.#weight = value;
  }
}

const read = (body: unknown) =>
  Effect.runPromise(Effect.result(readStepRecord(Parcel, body)));

describe('readStepRecord', () => {
  it('reads the record’s own members from a flat body, ignoring the rest', async () => {
    const outcome = await read({ weight: 3, groupId: 'g-1' });

    expect(outcome).toMatchObject({ _tag: 'Success', success: { weight: 3 } });
  });

  it('refuses a body that is no record as invalidBody', async () => {
    expect(await read(null)).toMatchObject({
      failure: { _tag: 'InvalidBody' },
    });
    expect(await read('not a record')).toMatchObject({
      failure: { _tag: 'InvalidBody' },
    });
  });
});
