'use client';

import { EntityTable, useCasesForSurface } from '@r10c/entifix-react-controls';
import {
  entityQueryScope,
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
import { useQueryClient } from '@tanstack/react-query';
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
import { useEntityAffordances } from './use-entity-affordances';
import { useEntityBulk } from './use-entity-bulk';

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
  options: EntityCrudOptions<TAdapters, TEntity>,
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
    metadataSource,
    runBulkUseCase,
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

    const queryClient = useQueryClient();
    const scope = entityQueryScope(entityConstructor);
    const affordances = useEntityAffordances(entityConstructor, metadataSource);

    const pager = useDataLoading<TEntity, CrudContext>({
      uc: loadUCFactory<TEntity>(),
      ctx: mergeContext(adapters, configuration, repository),
      // Scoped rather than left to the per-instance fallback, which is correct
      // but unshared: with the entity's own scope one invalidation refreshes
      // every page and filter of it, which is what a bulk run needs — and it is
      // the same prefix `useReactiveInvalidation`already targets, so a generated
      // list now also refreshes on a reactive change event.
      queryKey: scope,
    });

    // Only when this caller may actually run something over a selection.
    //
    // Measured live: an `admin` holds `catalog-reference:*:read` and no
    // `retire`, so the service filters the verb out of `$metadata` — but the
    // selection column still rendered, offering a set that no action could be
    // taken on. A checkbox that can lead nowhere is worse than no checkbox: it
    // reads as a permission the user does not have.
    //
    // Decided from the served document rather than from the runner, because
    // the runner is a property of the *shell* (it knows the route) and the
    // grant is a property of the *caller*. The column therefore appears when
    // the document lands, which is the asynchrony ADR 0026 already accepts for
    // every action surface.
    const canRunBulk =
      useCasesForSurface('bulk-bar', affordances.metadata?.useCases).length > 0;

    const bulk = useEntityBulk<TEntity>({
      run: canRunBulk ? runBulkUseCase : undefined,
      // A bulk write changed the rows underneath the listing, so the page is
      // re-read; the selection deliberately survives it (#121 — "the selection
      // is still there afterwards"), because the operator's next act is usually
      // to retry the failures or run a second verb on the same rows.
      onCompleted: () => {
        void queryClient.invalidateQueries({ queryKey: scope });
      },
    });

    return (
      <EntityTable
        entityConstructor={entityConstructor}
        {...pager}
        hrefFor={id => withLocale(`${basePath}/${String(id)}`)}
        newHref={withLocale(`${basePath}/${CATALOG_NEW_SLUG}`)}
        {...affordances}
        {...bulk.tableProps}
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
    draft,
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

    // The draft is spent once the write *commits*, and only here is that known:
    // `useEntityForm` neither fetches nor saves, so it cannot clear its own.
    // A failed mutation deliberately keeps the draft — the edit is still the
    // user's only copy of what they typed.
    const handleSave = async (next: TEntity) => {
      if (await save(next)) {
        draft?.clear();
        afterSave();
      }
    };

    const handleDelete = async () => {
      if (await remove(id)) {
        draft?.clear();
        afterDelete();
      }
    };

    return (
      <EntityCrudForm<TEntity>
        // Remounts (and reseeds the fields) once the record arrives.
        key={String(entity?.id ?? CATALOG_NEW_SLUG)}
        entityConstructor={entityConstructor}
        catalogKey={catalogKey}
        metadataSource={metadataSource}
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
        draft={draft}
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
