'use client';

import { EntityTable } from '@r10c/entifix-react-controls';
import {
  useDataLoading,
  useEntityMutation,
  useEntityRecord,
} from '@r10c/entifix-react-integration';
import {
  type ConfigurationRepositoryTag,
  deleteUCFactory,
  type EntityRepositoryTag,
  getUCFactory,
  loadUCFactory,
  saveUCFactory,
} from '@r10c/entifix-ts-business';
import {
  describeEntityColumns,
  EntifixBuildError,
  type Entity,
  type EntityConstructor,
  extractMetaEntity,
} from '@r10c/entifix-ts-core';
import { Context } from 'effect';
import { useParams, useRouter } from 'next/navigation';

import { useLocaleHref } from '../i18n';
import { EntityCrudForm } from './entity-crud-form';
import type {
  EntityCrud,
  EntityCrudLinkSource,
  EntityCrudOptions,
  EntityCrudSingleViewProps,
} from './make-entity-crud.types';
import { CATALOG_NEW_SLUG, slugToEntityId } from './slug';

/** What a picker defaults to reading off its target. */
const TARGET_NAME_PROPERTY = 'name';

type CrudContext = EntityRepositoryTag | ConfigurationRepositoryTag;

/**
 * Merges the configuration adapter with one repository adapter into the context
 * the use-cases run against.
 *
 * The casts are the price of naming adapters by key: `AdapterKey` narrows which
 * names may be *offered*, but TypeScript will not carry that narrowing through
 * an index access on a generic record. The alternative is every call site
 * passing two `Context` values per entity — the duplication this factory exists
 * to remove.
 */
function mergeContext<TAdapters>(
  adapters: TAdapters,
  configuration: keyof TAdapters,
  repository: keyof TAdapters,
): Context.Context<CrudContext> {
  return Context.merge(
    adapters[configuration] as Context.Context<ConfigurationRepositoryTag>,
    adapters[repository] as Context.Context<EntityRepositoryTag>,
  );
}

/**
 * Builds the list page and the single-record page for one entity.
 *
 * Every catalog entity used to cost ~10 files and ~300 lines whose only variable
 * was a class name: two organisms with a `.types.ts` each, two client pages, two
 * route files. The route files stay (Next needs a module per path); everything
 * between them is derived from the entity's own metadata, so a new reference
 * entity is this call plus a nav entry.
 *
 * Two things are checked here rather than at the call site, because both fail
 * silently otherwise. The catalog key must be the entity's own `@entity({ key })`
 * — they are the same string by convention, and a drifted one titles the form
 * after a different entity in a way only a reader of both catalogs would catch.
 * And a `links` entry must name a real member — a picker aimed at nothing renders
 * identically to a read-only field.
 *
 * **Serves compile-time `@entity()` classes only.** Operator reference data ships
 * with the code, so making this spec-driven would trade type safety for nothing;
 * a vendor-authored `EntitySpecification` renders through a separate path
 * (ADR 0014).
 */
export function makeEntityCrud<TEntity extends Entity, TAdapters>(
  entityConstructor: EntityConstructor<TEntity>,
  options: EntityCrudOptions<TAdapters>,
): EntityCrud<TEntity> {
  const {
    useAdapters,
    basePath,
    catalogKey,
    repository,
    configuration,
    hiddenFields = [],
    columns,
    links = [],
  } = options;

  const declaredKey = extractMetaEntity(entityConstructor).key;
  if (declaredKey !== catalogKey) {
    throw new EntifixBuildError(
      `${entityConstructor.name} declares key "${String(declaredKey)}" but was given catalog key "${catalogKey}"`,
    );
  }

  // Computed once: a descriptor is a property of the class, so nothing about it
  // depends on the record being edited. `linkLabelProperty`/`linkSearchProperty`
  // are overridden here because a scalar foreign key's `@accessor()` cannot name
  // the target's members — it may not import the target at all.
  const descriptors = describeEntityColumns(entityConstructor);
  const linkPlans = links.map(link => {
    const descriptor = descriptors.find(entry => entry.name === link.field);
    if (descriptor === undefined) {
      throw new EntifixBuildError(
        `${entityConstructor.name} has no member "${link.field}" for a link source`,
      );
    }
    return {
      ...link,
      descriptor: {
        ...descriptor,
        linkLabelProperty: link.labelProperty ?? TARGET_NAME_PROPERTY,
        linkSearchProperty: link.searchProperty ?? TARGET_NAME_PROPERTY,
      },
    };
  });

  function ListPage() {
    const adapters = useAdapters();
    // Every internal href carries the locale. An unprefixed one still resolves —
    // the middleware redirects it — but the visitor pays a round trip per click.
    const withLocale = useLocaleHref();

    const pager = useDataLoading<TEntity, CrudContext>({
      uc: loadUCFactory<TEntity>(),
      ctx: mergeContext(adapters, configuration, repository),
    });

    return (
      <EntityTable
        entityConstructor={entityConstructor}
        {...pager}
        hrefFor={id => withLocale(`${basePath}/${String(id)}`)}
        newHref={withLocale(`${basePath}/${CATALOG_NEW_SLUG}`)}
      >
        {columns}
      </EntityTable>
    );
  }

  /**
   * Dual-host: as a route it reads its slug from the URL and returns to the list
   * on save; in a workspace tab it takes the slug and the post-save action as
   * props.
   */
  function SingleViewPage({
    slug,
    onSaved,
    onDeleted,
    initialDraft,
    onDraftChange,
  }: EntityCrudSingleViewProps = {}) {
    const adapters = useAdapters();
    const router = useRouter();
    const withLocale = useLocaleHref();
    const params = useParams<{ slug: string }>();
    const id = slugToEntityId(slug ?? params.slug);

    const ctx = mergeContext(adapters, configuration, repository);

    const {
      entity,
      isLoading,
      error: loadError,
    } = useEntityRecord<TEntity, CrudContext>({
      uc: getUCFactory<TEntity>(),
      ctx,
      id,
    });

    const {
      save,
      remove,
      isSaving,
      isDeleting,
      error: writeError,
    } = useEntityMutation<TEntity, CrudContext>({
      saveUc: saveUCFactory<TEntity>(),
      deleteUc: deleteUCFactory<TEntity>(),
      ctx,
    });

    // Rebuilt inline on every render on purpose: `useEntityLinkSource` holds
    // these in a ref and keeps them out of its query keys, precisely so a caller
    // does not have to memoise them.
    const linkSources: EntityCrudLinkSource[] = linkPlans.map(plan => ({
      field: plan.field,
      descriptor: plan.descriptor,
      config: {
        entityConstructor: plan.entityConstructor,
        loadUc: loadUCFactory(),
        getUc: getUCFactory(),
        ctx: mergeContext(adapters, configuration, plan.repository),
      },
    }));

    const afterSave = onSaved ?? (() => router.push(withLocale(basePath)));
    const afterDelete = onDeleted ?? (() => router.push(withLocale(basePath)));

    const handleSave = async (next: TEntity) => {
      if (await save(next)) {
        afterSave();
      }
    };

    const handleDelete = async () => {
      if (await remove(id)) {
        afterDelete();
      }
    };

    return (
      <EntityCrudForm<TEntity>
        // Remounts (and reseeds the fields) once the record arrives.
        key={String(entity?.id ?? CATALOG_NEW_SLUG)}
        entityConstructor={entityConstructor}
        catalogKey={catalogKey}
        hiddenFields={hiddenFields}
        links={linkSources}
        entity={entity}
        isLoading={isLoading}
        isSaving={isSaving}
        isDeleting={isDeleting}
        error={loadError ?? writeError}
        onSave={handleSave}
        onDelete={id == null ? undefined : handleDelete}
        backHref={withLocale(basePath)}
        initialDraft={initialDraft}
        onDraftChange={onDraftChange}
      />
    );
  }

  return {
    entityConstructor,
    entityKey: catalogKey,
    basePath,
    ListPage,
    SingleViewPage,
  };
}
