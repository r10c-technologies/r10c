import { Effect, Exit } from 'effect';
import { describe, expect, it } from 'vitest';

import { EntifixBuildError } from '../../base-entities/entifix-error/index.js';
import type { Entity, EntityId } from '../../types/Entity.js';
import { accessor } from '../decorators/accessor/index.js';
import { entity } from '../decorators/entity/index.js';
import { EntityCollectionLink } from '../links/entity-collection-link/index.js';
import { EntityLink } from '../links/entity-link/index.js';
import {
  deserializeEntityCollection,
  deserializeSingleEntity,
} from './deserialize.js';
import { serializeEntity, serializeEntityCollection } from './serialize.js';

@entity({ key: 'tag' })
class Tag implements Entity {
  #id?: EntityId;
  #name?: string;

  @accessor()
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor()
  get name(): string | undefined {
    return this.#name;
  }
  set name(value: string | undefined) {
    this.#name = value;
  }
}

@entity({ key: 'article' })
class Article implements Entity {
  #id?: EntityId;
  #title?: string;
  #slug?: string;
  #secret?: string;
  #computed = 'derived';
  #primaryTag = new EntityLink(Tag);
  #tags = new EntityCollectionLink(Tag);

  @accessor()
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }

  @accessor()
  get title(): string | undefined {
    return this.#title;
  }
  set title(value: string | undefined) {
    this.#title = value;
  }

  /** Wire name differs from the member name. */
  @accessor({ alias: 'url_slug' })
  get slug(): string | undefined {
    return this.#slug;
  }
  set slug(value: string | undefined) {
    this.#slug = value;
  }

  @accessor({ hidden: true })
  get secret(): string | undefined {
    return this.#secret;
  }
  set secret(value: string | undefined) {
    this.#secret = value;
  }

  @accessor({ readonly: true })
  get computed(): string {
    return this.#computed;
  }

  @accessor()
  get primaryTag(): EntityLink<Tag> {
    return this.#primaryTag;
  }

  @accessor()
  get tags(): EntityCollectionLink<Tag> {
    return this.#tags;
  }
}

const deserialize = (data: unknown) =>
  Effect.runPromise(deserializeSingleEntity(Article, data));

const failureOf = async (effect: Effect.Effect<unknown, EntifixBuildError>) => {
  const exit = await Effect.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) throw new Error('expected a failure');
  const cause = exit.cause;
  if (cause._tag !== 'Fail') throw new Error(`expected Fail, got ${cause._tag}`);
  return cause.error;
};

describe('deserializeSingleEntity', () => {
  it('assigns scalar accessors through their setters', async () => {
    const article = await deserialize({ id: 'a-1', title: 'Hello' });

    expect(article).toBeInstanceOf(Article);
    expect(article?.id).toBe('a-1');
    expect(article?.title).toBe('Hello');
  });

  it('reads an aliased accessor from its wire name', async () => {
    const article = await deserialize({ id: 'a-1', 'url_slug': 'hello' });

    expect(article?.slug).toBe('hello');
  });

  // Hidden and read-only members are not part of the writable surface: a
  // payload must not be able to set a server-computed or secret field.
  it('ignores hidden and read-only members', async () => {
    const article = await deserialize({
      id: 'a-1',
      secret: 'leaked',
      computed: 'overridden',
    });

    expect(article?.secret).toBeUndefined();
    expect(article?.computed).toBe('derived');
  });

  it('leaves an absent property untouched', async () => {
    const article = await deserialize({ id: 'a-1' });

    expect(article?.title).toBeUndefined();
  });

  it('leaves a property explicitly set to undefined untouched', async () => {
    const article = await deserialize({ id: 'a-1', title: undefined });

    expect(article?.title).toBeUndefined();
  });

  it('assigns null through, since null is a value the wire can carry', async () => {
    const article = await deserialize({ id: 'a-1', title: null });

    expect(article?.title).toBeNull();
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
  ])('yields undefined for %s input', async (_label, data) => {
    expect(await deserialize(data)).toBeUndefined();
  });

  it('fails on a non-object payload, naming the type it got', async () => {
    const error = await failureOf(deserializeSingleEntity(Article, 'raw'));

    expect(error).toBeInstanceOf(EntifixBuildError);
    expect(error.message).toContain('Expected an object but got string');
  });

  describe('to-one links', () => {
    it('deserializes an embedded object into an instance', async () => {
      const article = await deserialize({
        id: 'a-1',
        primaryTag: { id: 't-1', name: 'Effect' },
      });

      expect(article?.primaryTag.isLoaded).toBe(true);
      expect(article?.primaryTag.value).toBeInstanceOf(Tag);
      expect(article?.primaryTag.value?.name).toBe('Effect');
    });

    it('stores a scalar as a foreign key without loading it', async () => {
      const article = await deserialize({ id: 'a-1', primaryTag: 't-9' });

      expect(article?.primaryTag.isLoaded).toBe(false);
      expect(article?.primaryTag.id).toBe('t-9');
    });

    it.each([
      ['absent', {}],
      ['null', { primaryTag: null }],
    ])('leaves the link empty when the value is %s', async (_label, extra) => {
      const article = await deserialize({ id: 'a-1', ...extra });

      expect(article?.primaryTag.id).toBeUndefined();
      expect(article?.primaryTag.isLoaded).toBe(false);
    });
  });

  describe('to-many links', () => {
    it('deserializes embedded members into instances', async () => {
      const article = await deserialize({
        id: 'a-1',
        tags: [
          { id: 't-1', name: 'Effect' },
          { id: 't-2', name: 'Nx' },
        ],
      });

      expect(article?.tags.isLoaded).toBe(true);
      expect(article?.tags.values?.map((tag) => tag.name)).toEqual(['Effect', 'Nx']);
    });

    it('stores scalar members as foreign keys', async () => {
      const article = await deserialize({ id: 'a-1', tags: ['t-1', 't-2'] });

      expect(article?.tags.isLoaded).toBe(false);
      expect(article?.tags.ids).toEqual(['t-1', 't-2']);
    });

    // A mixed array is what a partially-embedded payload looks like. Embedded
    // members win, since dropping them would lose data the server already sent.
    it('prefers the embedded members of a mixed array', async () => {
      const article = await deserialize({
        id: 'a-1',
        tags: ['t-1', { id: 't-2', name: 'Nx' }],
      });

      expect(article?.tags.isLoaded).toBe(true);
      expect(article?.tags.values?.map((tag) => tag.id)).toEqual(['t-2']);
    });

    it('skips null members', async () => {
      const article = await deserialize({ id: 'a-1', tags: ['t-1', null] });

      expect(article?.tags.ids).toEqual(['t-1']);
    });

    it.each([
      ['an empty array', []],
      ['an array of only nulls', [null]],
    ])('leaves the link empty for %s', async (_label, tags) => {
      const article = await deserialize({ id: 'a-1', tags });

      expect(article?.tags.ids).toEqual([]);
      expect(article?.tags.isLoaded).toBe(false);
    });

    it.each([
      ['a non-array value', { tags: 't-1' }],
      ['an absent value', {}],
    ])('leaves the link empty for %s', async (_label, extra) => {
      const article = await deserialize({ id: 'a-1', ...extra });

      expect(article?.tags.ids).toEqual([]);
    });
  });
});

describe('deserializeEntityCollection', () => {
  it('deserializes every member', async () => {
    const articles = await Effect.runPromise(
      deserializeEntityCollection(Article, [{ id: 'a-1' }, { id: 'a-2' }]),
    );

    expect(articles.map((article) => (article as Article).id)).toEqual(['a-1', 'a-2']);
  });

  it('yields undefined members for null entries', async () => {
    const articles = await Effect.runPromise(
      deserializeEntityCollection(Article, [null]),
    );

    expect(articles).toEqual([undefined]);
  });

  // Nested arrays exist so a grouped response can be deserialized in one pass.
  it('recurses into nested arrays', async () => {
    const articles = await Effect.runPromise(
      deserializeEntityCollection(Article, [[{ id: 'a-1' }], [{ id: 'a-2' }]]),
    );

    expect(articles).toHaveLength(2);
    expect(((articles[0] as Article[])[0] as Article).id).toBe('a-1');
  });

  it('treats a missing collection as empty by default', async () => {
    expect(await Effect.runPromise(deserializeEntityCollection(Article, null))).toEqual(
      [],
    );
  });

  it('fails on a missing collection when failOnNull is set', async () => {
    const error = await failureOf(deserializeEntityCollection(Article, null, true));

    expect(error.message).toContain('Expected an array but got object');
  });

  it('fails on a non-array payload', async () => {
    const error = await failureOf(deserializeEntityCollection(Article, { id: 'a-1' }));

    expect(error.message).toContain('Expected an array but got object');
  });

  // The build error raised inside the recursion is already the right error; it
  // must reach the caller rather than being wrapped a second time.
  it('surfaces a member failure without re-wrapping it', async () => {
    const error = await failureOf(deserializeEntityCollection(Article, ['raw']));

    expect(error.message).toContain('Expected an object but got string');
  });

  it('wraps a non-EntifixBuildError thrown during the build', async () => {
    const exploding = { get id() {
      throw new TypeError('boom');
    } };

    const error = await failureOf(deserializeSingleEntity(Article, exploding));

    expect(error).toBeInstanceOf(EntifixBuildError);
    expect(error.cause?.message).toBe('boom');
  });
});

describe('serializeEntity edge cases', () => {
  it('omits an empty to-many link rather than emitting []', () => {
    const article = new Article();
    article.id = 'a-1';

    expect(serializeEntity(Article, article)).toEqual({ id: 'a-1' });
  });

  it('emits ids for an unloaded to-many link', () => {
    const article = new Article();
    article.id = 'a-1';
    article.tags.setIds(['t-1', 't-2']);

    expect(serializeEntity(Article, article)).toEqual({
      id: 'a-1',
      tags: ['t-1', 't-2'],
    });
  });

  it('emits embedded objects for a loaded to-many link', () => {
    const tag = new Tag();
    tag.id = 't-1';
    tag.name = 'Effect';
    const article = new Article();
    article.id = 'a-1';
    article.tags.setValues([tag]);

    expect(serializeEntity(Article, article)).toEqual({
      id: 'a-1',
      tags: [{ id: 't-1', name: 'Effect' }],
    });
  });

  it('omits an unresolved to-one link', () => {
    const article = new Article();
    article.id = 'a-1';

    expect(serializeEntity(Article, article)).not.toHaveProperty('primaryTag');
  });

  it('writes an aliased accessor under its wire name', () => {
    const article = new Article();
    article.id = 'a-1';
    article.slug = 'hello';

    expect(serializeEntity(Article, article)).toEqual({
      id: 'a-1',
      'url_slug': 'hello',
    });
  });

  it('omits hidden and read-only members', () => {
    const article = new Article();
    article.id = 'a-1';
    article.secret = 'nope';

    const serialized = serializeEntity(Article, article);

    expect(serialized).not.toHaveProperty('secret');
    expect(serialized).not.toHaveProperty('computed');
  });

  it('serializes a whole collection', () => {
    const first = new Article();
    first.id = 'a-1';
    const second = new Article();
    second.id = 'a-2';

    expect(serializeEntityCollection(Article, [first, second])).toEqual([
      { id: 'a-1' },
      { id: 'a-2' },
    ]);
  });
});
