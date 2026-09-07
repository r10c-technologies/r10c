'use client';

import { EntityTable, useCasesForSurface } from '@r10c/entifix-react-controls';
import {
  entityQueryScope,
  useDataLoading,
  useEntityMutation,
  useEntityRecord,
} from '@r10c/entifix-react-integration';
import type { TransactionSink } from '@r10c/entifix-transactions';
import { TransactionSinkTag } from '@r10c/entifix-transactions';
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
  envelopeEntityName,
  extractMetaEntity,
} from '@r10c/entifix-ts-core';
import { useQueryClient } from '@tanstack/react-query';
import { Context } from 'effect';
import { useParams, useRouter } from 'next/navigation';

import { useLocaleHref } from '../i18n';
import {
  pendingFor,
  pendingRecordsFor,
  usePendingTransactions,
} from '../workspace/pending-transactions';
import { EntityCrudForm } from './entity-crud-form';
import { handOffWrite } from './hand-off-write';
import type {
  EntityCrud,
  EntityCrudLinkSource,
  EntityCrudOptions,
  EntityCrudSingleViewProps,
} from './make-entity-crud.types';
import { PendingNotice } from './pending-notice';
import { CATALOG_NEW_SLUG, slugToEntityId } from './slug';
import { useEntityAffordances } from './use-entity-affordances';
import { useEntityBulk } from './use-entity-bulk';

/** What a picker defaults to reading off its target. */
const TARGET_NAME_PROPERTY = 'name';

/**
 * What the generated pages' use-cases run against.
 *
 * Exported because a hand-built screen needs the same three: a wizard reads
 * records, resolves pickers and writes through exactly these ports, and
 * rebuilding the union at each such call site is how one of them ends up
 * missing `TransactionSinkTag` and quietly losing its optimistic treatment.
 */
export type CrudContext =
  | EntityRepositoryTag
  | ConfigurationRepositoryTag
  | TransactionSinkTag;

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
export function mergeCrudContext<TAdapters>(
  adapters: TAdapters,
  configuration: keyof TAdapters,
  repository: keyof TAdapters,
  sink: TransactionSink,
): Context.Context<CrudContext> {
  return Context.add(
    Context.merge(
      adapters[configuration] as Context.Context<ConfigurationRepositoryTag>,
      adapters[repository] as Context.Context<EntityRepositoryTag>,
    ),
    TransactionSinkTag,
    sink,
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
    toolbar,
    links = [],
    metadataSource,
    runBulkUseCase,
  } = options;

  const meta = extractMetaEntity(entityConstructor);
  if (meta.key !== catalogKey) {
    throw new EntifixBuildError(
      `${entityConstructor.name} declares key "${String(meta.key)}" but was given catalog key "${catalogKey}"`,
    );
  }
  // Read off `@entity()` rather than rebuilt from `catalogKey`. Both spellings
  // produce the same string today, and that is exactly the problem: a second
  // place that knows how an entity's catalog subtree is laid out is a second
  // place to fix when one moves. `MetaEntityOptions` makes them optional, so an
  // entity that never declared them fails here — where a screen is generated —
  // rather than on the render that first tries to title a tab with `undefined`.
  const { labelKey: entityLabelKey, pluralKey: entityPluralKey } = meta;
  if (entityLabelKey === undefined || entityPluralKey === undefined) {
    throw new EntifixBuildError(
      `${entityConstructor.name} must declare labelKey and pluralKey on @entity() to be generated`,
    );
  }

  // Computed once: a descriptor is a property of the class, so nothing about it
  // depends on the record being edited. `linkLabelProperty`/`linkSearchProperty`
  // are overridden here because a scalar foreign key's `@accessor()` cannot name
  // the target's members — it may not import the target at all.
  // The wire name, which is also what a pending entry records and what
  // `entityQueryScopeFor` keys on — one derivation, so a notice and an
  // invalidation can never disagree about which entity they mean.
  const entityName = envelopeEntityName(entityConstructor);
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
    // Outside a `PendingTransactionsProvider` this watches nothing, so a host
    // that has not mounted one behaves exactly as it did before.
    const pending = usePendingTransactions();
    // Every internal href carries the locale. An unprefixed one still resolves —
    // the middleware redirects it — but the visitor pays a round trip per click.
    const withLocale = useLocaleHref();

    const queryClient = useQueryClient();
    const scope = entityQueryScope(entityConstructor);
    const affordances = useEntityAffordances(entityConstructor, metadataSource);

    // Records this browser has created but the service has not finished
    // writing. Prepended below rather than patched into the cache, which a
    // refetch would undo.
    const optimistic = pendingRecordsFor<TEntity>(pending, entityName);

    const pager = useDataLoading<TEntity, CrudContext>({
      uc: loadUCFactory<TEntity>(),
      ctx: mergeCrudContext(adapters, configuration, repository, pending),
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
      <div className="flex flex-col gap-s">
        {/* Above the table, because this is where `afterSave()` leaves the
            operator after a create — and a create is the only transactional
            write there is, so this is the surface the pending state has. */}
        <PendingNotice
          entries={pendingFor(pending, entityName)}
          onDismiss={pending.dismiss}
        />
        <EntityTable
          entityConstructor={entityConstructor}
          {...pager}
          items={[...optimistic, ...pager.items]}
          totalItems={pager.totalItems + optimistic.length}
          hrefFor={id => withLocale(`${basePath}/${String(id)}`)}
          newHref={withLocale(`${basePath}/${CATALOG_NEW_SLUG}`)}
          {...affordances}
          {...bulk.tableProps}
        >
          {columns}
          {toolbar}
        </EntityTable>
      </div>
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
    const pending = usePendingTransactions();
    const router = useRouter();
    const withLocale = useLocaleHref();
    const params = useParams<{ slug: string }>();
    const id = slugToEntityId(slug ?? params.slug);

    const ctx = mergeCrudContext(adapters, configuration, repository, pending);

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
        ctx: mergeCrudContext(adapters, configuration, plan.repository, pending),
      },
    }));

    const afterSave = onSaved ?? (() => router.push(withLocale(basePath)));
    const afterDelete = onDeleted ?? (() => router.push(withLocale(basePath)));

    // The draft is spent once the write *commits*, and only here is that known:
    // `useEntityForm` neither fetches nor saves, so it cannot clear its own.
    // A failed mutation deliberately keeps the draft — the edit is still the
    // user's only copy of what they typed.
    const handleSave = async (next: TEntity) => {
      const saved = await save(next);
      if (saved === undefined) return;

      // ⚠️ Deliberately *not* a `setQueriesData` patch. The list refetches on
      // mount — precisely when the operator arrives, having just been navigated
      // here — and the server legitimately does not hold the record yet, so the
      // refetch would replace the patched page and the row would vanish a
      // moment after appearing. The pending set outlives refetches.
      handOffWrite({ id: String(saved.id), record: saved, pending, draft });
      afterSave();
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
    entityLabelKey,
    entityPluralKey,
    basePath,
    ListPage,
    SingleViewPage,
  };
}
