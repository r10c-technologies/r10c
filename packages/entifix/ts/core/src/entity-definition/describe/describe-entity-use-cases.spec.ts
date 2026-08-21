import { EntifixBuildError } from '../../base-entities/entifix-error/index.js';
import {
  accessor,
  describeEntityUseCases,
  Entity,
  entity,
  EntityId,
  extractMetaUseCaseBinding,
  useCase,
} from '../../index.js';

@entity({ domain: 'catalog', key: 'article' })
class Article implements Entity {
  #id?: EntityId;

  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }
}

@entity({ domain: 'catalog', key: 'shelf' })
class Shelf implements Entity {
  #id?: EntityId;

  @accessor({ type: 'id' })
  get id(): EntityId {
    return this.#id;
  }
  set id(value: EntityId) {
    this.#id = value;
  }
}

/** Never decorated, so it has no metadata of its own to append to. */
class Undeclared implements Entity {
  id: EntityId;
}

@useCase({
  entity: Article,
  key: 'publish',
  binding: 'entity',
  placement: 'determining',
  labelKey: 'entity:article.useCases.publish',
})
class PublishArticleUC {}

@useCase({
  entity: Article,
  key: 'archive',
  binding: 'collection',
  placement: 'context-dependent',
  labelKey: 'entity:article.useCases.archive',
  keywordsKey: 'entity:article.useCases.archiveKeywords',
  confirm: {
    tone: 'destructive',
    messageKey: 'entity:article.useCases.archiveConfirm',
  },
  form: 'archive-reason',
})
class ArchiveArticlesUC {}

class NeverDecoratedUC {}

describe('useCase', () => {
  it('appends every declared use case to the entity, in declaration order', () => {
    expect(describeEntityUseCases(Article)).toEqual([
      {
        key: 'publish',
        binding: 'entity',
        placement: 'determining',
        labelKey: 'entity:article.useCases.publish',
        keywordsKey: undefined,
        confirm: undefined,
        form: undefined,
      },
      {
        key: 'archive',
        binding: 'collection',
        placement: 'context-dependent',
        labelKey: 'entity:article.useCases.archive',
        keywordsKey: 'entity:article.useCases.archiveKeywords',
        confirm: {
          tone: 'destructive',
          messageKey: 'entity:article.useCases.archiveConfirm',
        },
        form: 'archive-reason',
      },
    ]);
  });

  it('never leaks a verb onto an entity that did not declare it', () => {
    expect(describeEntityUseCases(Shelf)).toEqual([]);
  });

  it('records the entity and verb on the use-case class itself', () => {
    expect(extractMetaUseCaseBinding(PublishArticleUC)).toEqual({
      entity: Article,
      key: 'publish',
    });
    expect(extractMetaUseCaseBinding(ArchiveArticlesUC).key).toBe('archive');
  });

  it('refuses a target that carries no metadata of its own', () => {
    expect(() =>
      useCase({
        entity: Undeclared,
        key: 'publish',
        binding: 'entity',
        placement: 'determining',
        labelKey: 'entity:undeclared.useCases.publish',
      })(Undeclared, { metadata: {} } as ClassDecoratorContext),
    ).toThrow(EntifixBuildError);
  });

  it('refuses to read a binding off an undecorated class', () => {
    expect(() => extractMetaUseCaseBinding(NeverDecoratedUC)).toThrow(
      EntifixBuildError,
    );
  });
});
