import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import { EntifixBuildError } from '../base-entities/entifix-error/index.js';
import { accessor } from '../entity-definition/decorators/accessor/index.js';
import { entity } from '../entity-definition/decorators/entity/index.js';
import { useCase } from '../entity-definition/decorators/use-case/index.js';
import { describeEntityUseCases } from '../entity-definition/describe/index.js';
import type { EntityMetadataDocument } from '../entity-definition/metadata/index.js';
import type { Entity, EntityId } from '../types/Entity.js';
import { ENTITY_ACTIONS } from '../types/EntityAction.js';
import {
  makeEntityEnvelope,
  makeEntityMetadataEnvelope,
} from './make-envelope.js';
import { readEntityMetadataEnvelope } from './read-envelope.js';

@entity({ domain: 'authn', key: 'account' })
class Account implements Entity {
  #id?: EntityId;

  @accessor()
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }
}

@useCase({
  entity: Account,
  key: 'suspend',
  binding: 'entity',
  placement: 'context-independent',
  labelKey: 'entity:account.useCases.suspend',
  confirm: {
    tone: 'destructive',
    messageKey: 'entity:account.useCases.suspendConfirm',
  },
})
class SuspendAccountUC {
  static run() {
    return undefined;
  }
}

const documentOf = (): EntityMetadataDocument => ({
  actions: [...ENTITY_ACTIONS],
  useCases: describeEntityUseCases(Account),
});

describe('makeEntityMetadataEnvelope', () => {
  it('labels the envelope with the entity key and carries the document verbatim', () => {
    const envelope = makeEntityMetadataEnvelope(Account, documentOf());

    expect(envelope.meta).toEqual({
      type: 'entityMetadata',
      entity: 'account',
    });
    expect(envelope.data.actions).toEqual(['read', 'write', 'delete']);
    expect(envelope.data.useCases).toEqual([
      {
        key: 'suspend',
        binding: 'entity',
        placement: 'context-independent',
        labelKey: 'entity:account.useCases.suspend',
        keywordsKey: undefined,
        confirm: {
          tone: 'destructive',
          messageKey: 'entity:account.useCases.suspendConfirm',
        },
        form: undefined,
      },
    ]);
    // The class itself never travels — only its declared affordances do.
    expect(envelope.data.useCases[0]).not.toHaveProperty('run');
    expect(SuspendAccountUC.run()).toBeUndefined();
  });

  it('carries links when the route supplies them', () => {
    const envelope = makeEntityMetadataEnvelope(Account, documentOf(), [
      { rel: 'self', href: '/api/account/$metadata', method: 'GET' },
    ]);

    expect(envelope.meta.links).toEqual([
      { rel: 'self', href: '/api/account/$metadata', method: 'GET' },
    ]);
  });
});

describe('readEntityMetadataEnvelope', () => {
  it('round-trips a built envelope', async () => {
    const document = documentOf();

    const read = await Effect.runPromise(
      readEntityMetadataEnvelope(
        Account,
        makeEntityMetadataEnvelope(Account, document),
      ),
    );

    expect(read).toEqual(document);
  });

  it('rejects an envelope of another type', async () => {
    const wrong = makeEntityEnvelope(Account, new Account());

    const failure = await Effect.runPromise(
      Effect.flip(readEntityMetadataEnvelope(Account, wrong)),
    );

    expect(failure).toBeInstanceOf(EntifixBuildError);
    expect(failure.message).toContain('entityMetadata');
  });

  it.each([
    ['a missing document', undefined],
    ['a document with no actions', { useCases: [] }],
    ['a document with no useCases', { actions: [] }],
  ])('fails loudly on %s', async (_label, data) => {
    const failure = await Effect.runPromise(
      Effect.flip(
        readEntityMetadataEnvelope(Account, {
          meta: { type: 'entityMetadata', entity: 'account' },
          data,
        }),
      ),
    );

    expect(failure).toBeInstanceOf(EntifixBuildError);
    expect(failure.message).toContain('carried no metadata document');
  });
});
